"""Decoding grader: phoneme recognition + edit distance against the expected
phoneme sequence ("did the child read the right word?").

Ported unchanged from the calibrated test harness (validated against
speechocean762 expert scores — see docs/DECODING_GRADER.md). wav2vec2 CTC
phoneme recognition (no lexicon/language model, so nothing "snaps" a
misreading to the expected word), CMUdict expected sequences with all
pronunciation variants, global alignment, per-word phoneme-error-rate.
"""
import io
import json
import os
import re
import statistics
import wave

import numpy as np
import pronouncing
import torch

MODEL_ID = os.environ.get('MDD_MODEL', 'facebook/wav2vec2-xlsr-53-espeak-cv-ft')
# Longest clip we will run inference on: wav2vec2 attention cost grows with
# the square of the sequence, so unbounded audio means minute-long CPU stalls.
MAX_SECONDS = float(os.environ.get('MDD_MAX_SECONDS', '60'))

# Names / gaps in CMUdict. Extend via MDD_EXTRA_PRONS=/path/to.json
# ({"word": ["ARPABET PRON", ...], ...}) as the app's reading list grows.
MANUAL_PRONS = {
    'layla': ['L EY1 L AH0'],
    'dora': ['D AO1 R AH0'],
    'lilly': ['L IH1 L IY0'],
    'billy': ['B IH1 L IY0'],
}
if os.environ.get('MDD_EXTRA_PRONS'):
    MANUAL_PRONS.update(json.load(open(os.environ['MDD_EXTRA_PRONS'])))

CMU_TO_IPA = {
    'AA': 'ɑ', 'AE': 'æ', 'AH': 'ə', 'AO': 'ɔ', 'AW': 'aʊ', 'AY': 'aɪ',
    'B': 'b', 'CH': 'tʃ', 'D': 'd', 'DH': 'ð', 'EH': 'ɛ', 'ER': 'ɚ',
    'EY': 'eɪ', 'F': 'f', 'G': 'ɡ', 'HH': 'h', 'IH': 'ɪ', 'IY': 'i',
    'JH': 'dʒ', 'K': 'k', 'L': 'l', 'M': 'm', 'N': 'n', 'NG': 'ŋ',
    'OW': 'oʊ', 'OY': 'ɔɪ', 'P': 'p', 'R': 'ɹ', 'S': 's', 'SH': 'ʃ',
    'T': 't', 'TH': 'θ', 'UH': 'ʊ', 'UW': 'u', 'V': 'v', 'W': 'w',
    'Y': 'j', 'Z': 'z', 'ZH': 'ʒ',
}
# One comparison space for model output and expected phones: strip stress and
# length, merge near-equivalents (incl. the cot–caught merger — decoding
# verdicts shouldn't hinge on dialect vowels).
IPA_EQUIV = {
    'ɐ': 'ə', 'ᵻ': 'ɪ', 'ɚ': 'ə', 'ɝ': 'ə', 'ɜ': 'ə', 'ʌ': 'ə',
    'ɾ': 't', 'r': 'ɹ', 'g': 'ɡ', 'iː': 'i', 'uː': 'u', 'ɑː': 'ɑ',
    'ɔː': 'ɑ', 'ɔ': 'ɑ', 'oː': 'o', 'ɛɹ': 'ɛ', 'x': 'k',
    'ʧ': 'tʃ', 'ʤ': 'dʒ',
}


def _norm_ipa(tok):
    tok = tok.replace('ˈ', '').replace('ˌ', '').replace('̩', '').replace('̃', '')
    tok = IPA_EQUIV.get(tok, tok)
    tok = tok.replace('ː', '')
    return IPA_EQUIV.get(tok, tok)


def expected_variants(word):
    w = re.sub(r"[^a-z']", '', word.lower())
    prons = pronouncing.phones_for_word(w) or MANUAL_PRONS.get(w)
    if not prons:
        raise KeyError(w)
    return [[_norm_ipa(CMU_TO_IPA[re.sub(r'\d', '', p)]) for p in pron.split()] for pron in prons]


def edit_distance(a, b):
    n, m = len(a), len(b)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            dp[i][j] = min(dp[i - 1][j] + 1, dp[i][j - 1] + 1,
                           dp[i - 1][j - 1] + (a[i - 1] != b[j - 1]))
    return dp[n][m]


def align_spans(expected, word_of, recognized):
    """Global alignment; recognized span [start, end) per expected word."""
    n, m = len(expected), len(recognized)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            dp[i][j] = min(dp[i - 1][j] + 1, dp[i][j - 1] + 1,
                           dp[i - 1][j - 1] + (expected[i - 1] != recognized[j - 1]))
    i, j = n, m
    consumed = [[] for _ in range(n)]
    while i > 0 or j > 0:
        if i > 0 and j > 0 and dp[i][j] == dp[i - 1][j - 1] + (expected[i - 1] != recognized[j - 1]):
            consumed[i - 1].append(j - 1)
            i, j = i - 1, j - 1
        elif j > 0 and dp[i][j] == dp[i][j - 1] + 1:
            if i > 0:
                consumed[i - 1].append(j - 1)
            i, j = i, j - 1
        else:
            i, j = i - 1, j
    nwords = max(word_of) + 1 if word_of else 0
    spans = []
    for w in range(nwords):
        idxs = [r for e_i in range(n) if word_of[e_i] == w for r in consumed[e_i]]
        spans.append((min(idxs), max(idxs) + 1) if idxs else (0, 0))
    return spans


class Grader:
    def __init__(self):
        from huggingface_hub import hf_hub_download
        from transformers import AutoModelForCTC, Wav2Vec2FeatureExtractor

        self.feature_extractor = Wav2Vec2FeatureExtractor.from_pretrained(MODEL_ID)
        self.model = AutoModelForCTC.from_pretrained(MODEL_ID)
        self.model.eval()
        vocab = json.load(open(hf_hub_download(MODEL_ID, 'vocab.json')))
        self.id2tok = {i: t for t, i in vocab.items()}
        self.skip = {'<pad>', '<s>', '</s>', '<unk>', '[PAD]', '[UNK]', '|', ' '}

    def _decode_wav(self, wav_bytes):
        with wave.open(io.BytesIO(wav_bytes), 'rb') as f:
            rate, channels, width = f.getframerate(), f.getnchannels(), f.getsampwidth()
            if width != 2:
                raise ValueError(f'expected 16-bit PCM WAV, got {width * 8}-bit')
            audio = np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        if channels > 1:
            audio = audio.reshape(-1, channels).mean(axis=1)
        if rate != 16000:  # browser AudioContexts often run at 44.1/48 kHz
            target = int(len(audio) * 16000 / rate)
            audio = np.interp(np.linspace(0, len(audio), target, endpoint=False),
                              np.arange(len(audio)), audio).astype(np.float32)
        return audio

    def recognize(self, wav_bytes):
        audio = self._decode_wav(wav_bytes)
        if len(audio) > int(16000 * MAX_SECONDS):
            raise ValueError(f'audio too long ({len(audio) / 16000:.0f}s > {MAX_SECONDS:.0f}s)')
        inputs = self.feature_extractor(audio, sampling_rate=16000, return_tensors='pt')
        with torch.no_grad():
            logits = self.model(inputs.input_values).logits
        ids = torch.argmax(logits, dim=-1)[0].tolist()
        toks, prev = [], None
        for i in ids:
            if i != prev:
                t = self.id2tok.get(i, '')
                if t not in self.skip:
                    toks.append(t)
            prev = i
        return [_norm_ipa(t) for t in toks if t.strip()]

    def assess(self, wav_bytes, reference_text):
        ref_words = reference_text.split()
        variants_per_word = [expected_variants(w) for w in ref_words]
        canonical, word_of = [], []
        for wi, variants in enumerate(variants_per_word):
            canonical.extend(variants[0])
            word_of.extend([wi] * len(variants[0]))
        recognized = self.recognize(wav_bytes)
        spans = align_spans(canonical, word_of, recognized)
        words = []
        for wi, w in enumerate(ref_words):
            s, e = spans[wi]
            span = recognized[s:e]
            per = min(edit_distance(v, span) / len(v) for v in variants_per_word[wi])
            words.append({
                'word': w, 'per': round(per, 3),
                'score': round(max(0.0, 1 - per) * 100, 1),
                'expected': ' '.join(variants_per_word[wi][0]),
                'heard': ' '.join(span),
            })
        return {
            'recognized': ' '.join(recognized),
            'words': words,
            'sentence_score': round(statistics.mean(w['score'] for w in words), 1) if words else 0,
        }
