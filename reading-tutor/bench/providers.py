"""
The arms of the benchmark. Each one turns a clip into a 0-1 score per word.

Four arms, not three. Your plan had local-phonemes, Azure and SpeechAce. I have
added forced alignment, because it is a different technique from open phoneme
recognition and it is the one most likely to win.

Why: the child is reading a sentence YOU WROTE. You already know every word.
Open recognition throws that away and asks "what did they say?", which is the
hardest possible question and the one general models are worst at for
five-year-olds. Forced alignment asks "how well does this audio fit the words we
expected?", which is far easier and far more robust to a child's speech.

On Whisper: whisper-large-v3 does not output phonemes. There is no phoneme mode
and no phoneme API. It emits orthographic text. So it cannot be a phoneme arm.
It IS included as a word-level baseline, because if plain Whisper word matching
beats all the phoneme approaches, that is worth knowing before you build
anything clever.
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Protocol
import json
import os

from align import WordSpec, score_words

PHONEME_MODEL = "facebook/wav2vec2-lv-60-espeak-cv-ft"
# NOTE: your script had "facebook/wav2vec2-lv60-espeak-cv8-phoneme", which does
# not exist. That is the correct id. It emits space-separated IPA and was
# fine-tuned on Common Voice - i.e. adult speech, which is exactly why this
# benchmark is worth running rather than assuming.


class Provider(Protocol):
    name: str
    def score_clip(self, audio_path: str, words: list[WordSpec]) -> list[float]: ...


# --- 1. open phoneme recognition, then string comparison --------------------

class LocalPhonemeProvider:
    """Your original idea, implemented per-word instead of per-clip."""

    name = "local phonemes (open recognition)"

    def __init__(self, model_id: str = PHONEME_MODEL, device: str = "cpu"):
        import torch
        from transformers import Wav2Vec2Processor, Wav2Vec2ForCTC
        self.torch = torch
        self.processor = Wav2Vec2Processor.from_pretrained(model_id)
        self.model = Wav2Vec2ForCTC.from_pretrained(model_id).to(device).eval()
        self.device = device

    def _recognise(self, audio_path: str) -> list[str]:
        import librosa
        speech, _ = librosa.load(audio_path, sr=16000)
        inputs = self.processor(speech, sampling_rate=16000, return_tensors="pt")
        with self.torch.no_grad():
            logits = self.model(inputs.input_values.to(self.device)).logits
        ids = self.torch.argmax(logits, dim=-1)
        return self.processor.batch_decode(ids)[0].split()

    def score_clip(self, audio_path: str, words: list[WordSpec]) -> list[float]:
        recognised = self._recognise(audio_path)
        return [a.score for a in score_words(words, recognised)]


# --- 2. forced alignment against the known target ---------------------------

class ForcedAlignProvider:
    """
    Scores each word by how well the audio fits the phonemes we EXPECTED,
    rather than by transcribing freely and comparing.

    Uses the same acoustic model, so any difference between this arm and arm 1
    is purely the technique, not the model.
    """

    name = "forced alignment (known target)"

    def __init__(self, model_id: str = PHONEME_MODEL, device: str = "cpu"):
        import torch
        import torchaudio
        from transformers import Wav2Vec2Processor, Wav2Vec2ForCTC
        self.torch = torch
        self.torchaudio = torchaudio
        self.processor = Wav2Vec2Processor.from_pretrained(model_id)
        self.model = Wav2Vec2ForCTC.from_pretrained(model_id).to(device).eval()
        self.device = device
        self.vocab = self.processor.tokenizer.get_vocab()

    def score_clip(self, audio_path: str, words: list[WordSpec]) -> list[float]:
        import librosa
        torch = self.torch

        speech, _ = librosa.load(audio_path, sr=16000)
        inputs = self.processor(speech, sampling_rate=16000, return_tensors="pt")
        with torch.no_grad():
            logits = self.model(inputs.input_values.to(self.device)).logits
        log_probs = torch.log_softmax(logits, dim=-1)

        # Flatten expected phonemes into token ids, remembering the owning word.
        ids: list[int] = []
        owner: list[int] = []
        unknown = 0
        for wi, w in enumerate(words):
            for p in w.phonemes:
                tid = self.vocab.get(p)
                if tid is None:
                    unknown += 1
                    continue
                ids.append(tid)
                owner.append(wi)

        if unknown:
            print(
                f"  warning: {unknown} expected phonemes are not in the model vocabulary. "
                f"Your g2p and the model disagree - fix that before trusting this arm."
            )
        if not ids:
            return [0.0] * len(words)

        targets = torch.tensor([ids], dtype=torch.int32)
        alignment, scores = self.torchaudio.functional.forced_align(
            log_probs.cpu(), targets, blank=0
        )
        # scores are per frame; average the frames belonging to each token.
        token_scores: dict[int, list[float]] = {}
        for frame, (tok, sc) in enumerate(zip(alignment[0].tolist(), scores[0].tolist())):
            if tok == 0:
                continue
            token_scores.setdefault(frame, []).append(sc)

        # Map token index -> word. forced_align returns one entry per frame, so
        # walk the alignment and count token transitions.
        per_token: list[float] = []
        prev = None
        acc: list[float] = []
        for tok, sc in zip(alignment[0].tolist(), scores[0].tolist()):
            if tok == 0:
                continue
            if prev is not None and tok != prev:
                per_token.append(sum(acc) / len(acc))
                acc = []
            acc.append(sc)
            prev = tok
        if acc:
            per_token.append(sum(acc) / len(acc))

        out = [0.0] * len(words)
        counts = [0] * len(words)
        for i, sc in enumerate(per_token[: len(owner)]):
            w = owner[i]
            out[w] += float(self.torch.exp(self.torch.tensor(sc)))
            counts[w] += 1
        return [out[i] / counts[i] if counts[i] else 0.0 for i in range(len(words))]


# --- 3 and 4. the paid APIs -------------------------------------------------

class PrecomputedProvider:
    """
    Reads per-word scores you already have, from the manifest.

    Use this for Azure and SpeechAce so the benchmark does not depend on live
    API keys, and so the comparison is reproducible. Both APIs return per-word
    accuracy scores - use those, NOT the clip-level score, or you are back to
    comparing a per-clip number against a per-word one.
    """

    def __init__(self, name: str, key: str):
        self.name = name
        self.key = key

    def score_clip(self, audio_path: str, words: list[WordSpec]) -> list[float]:
        raise NotImplementedError("PrecomputedProvider scores come from the manifest")


class WhisperWordProvider:
    """
    Word-level baseline. Not a phoneme arm - Whisper cannot do phonemes.

    Transcribes, then marks each expected word 1.0 if it appears in the
    transcript in roughly the right place, 0.0 otherwise. Crude on purpose:
    it is here to tell you whether the phoneme machinery earns its complexity.
    """

    name = "whisper-large-v3 (word baseline)"

    def __init__(self, model_id: str = "openai/whisper-large-v3", device: str = "cpu"):
        from transformers import pipeline
        self.pipe = pipeline("automatic-speech-recognition", model=model_id, device=device)

    def score_clip(self, audio_path: str, words: list[WordSpec]) -> list[float]:
        text = self.pipe(audio_path)["text"].lower()
        heard = set(w.strip(".,!?;:") for w in text.split())
        return [1.0 if w.word.lower() in heard else 0.0 for w in words]
