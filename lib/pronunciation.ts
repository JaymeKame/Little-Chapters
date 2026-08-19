/* Reading-assessment pipeline (browser side).
 *
 * One getUserMedia stream is shared by two consumers:
 *   - the Azure Speech SDK (AudioConfig.fromStreamInput) — streams audio over
 *     websocket to Azure and returns pronunciation-assessment JSON, and
 *   - a MediaRecorder — keeps a local copy so the kid/parent can replay the
 *     reading (assessment still works if MediaRecorder is unavailable).
 *
 * Continuous recognition (not recognizeOnce): a 5-year-old reads slowly with
 * long pauses, so Azure may split one passage into several "segments". Each
 * segment carries its own scores; stop() re-aggregates them into passage-level
 * scores. IMPORTANT: in continuous mode the service does NOT return
 * Omission/Insertion miscue labels even with enableMiscue=true — Microsoft's
 * own continuous samples re-align the recognized words against the reference
 * text client-side, and aggregate() below does the same (LCS diff), so
 * skipped words really do surface as omissions and re-read words as
 * insertions.
 *
 * The Azure key stays on the server — we fetch a ~10-min authorization token
 * from /api/speech/token and hand that to the SDK, refreshing it on the
 * recognizer every 4 minutes for long sessions.                              */

import type {
  AudioConfig,
  SpeechRecognizer,
} from 'microsoft-cognitiveservices-speech-sdk';

/* ── Result types ──────────────────────────────────────────────────────── */

export type WordErrorType =
  | 'None'
  | 'Mispronunciation'
  | 'Omission'
  | 'Insertion'
  | 'UnexpectedBreak'
  | 'MissingBreak'
  | 'Monotone'
  | 'Unassessed' // service returned no assessment block for this word
  | string;

export interface PhonemeScore {
  phoneme: string;
  accuracy: number | null;
}

export interface WordScore {
  word: string;
  /** 0–100; null for omitted/unassessed words the service didn't score. */
  accuracy: number | null;
  errorType: WordErrorType;
  offsetMs: number | null;
  durationMs: number | null;
  phonemes: PhonemeScore[];
}

export interface ReadingScores {
  /** Overall 0–100, weighted blend of the others. */
  pronunciation: number;
  /** How close each spoken word was to native pronunciation. */
  accuracy: number;
  /** Pauses/hesitations between words. */
  fluency: number;
  /** Share of the reference text actually read correctly. */
  completeness: number;
  /** Stress/intonation/rhythm — null when the locale doesn't support it. */
  prosody: number | null;
}

export interface ReadingAssessmentResult {
  scores: ReadingScores;
  /** Reference-aligned words: omissions/insertions synthesized client-side. */
  words: WordScore[];
  /** What the child actually said (recognized text, all segments joined). */
  transcript: string;
  referenceText: string;
  /** Local recording for playback; null if MediaRecorder was unavailable. */
  audio: Blob | null;
  /** Uncompressed 16-bit PCM WAV of the same take — the input the decoding
   *  grader (/api/reading/decode) needs; null if WebAudio capture failed. */
  audioWav: Blob | null;
  /** Wall-clock length of the session in ms. */
  durationMs: number;
  /** Non-null when the session died mid-passage: scores cover only the part
   *  that was assessed before the failure — never treat them as complete. */
  warning: string | null;
  /** Raw Azure JSON per segment — keep while tuning, drop for prod. */
  raw: unknown[];
}

export type ReadingSessionStatus =
  | 'connecting'
  | 'listening'
  | 'stopping'
  | 'done'
  | 'error';

export interface ReadingSessionOptions {
  referenceText: string;
  /** BCP-47 locale, default en-US. Prosody is only requested for English. */
  locale?: string;
  /** Firebase ID token; required in prod where the token route is gated. */
  authToken?: string | null;
  /** Live partial transcript while the child is speaking. */
  onPartialTranscript?: (text: string) => void;
  /** Fired when Azure finalizes a segment — per-word feedback mid-passage.
   *  These are raw (un-aligned) words; the final result's words are aligned. */
  onSegment?: (words: WordScore[]) => void;
  onStatus?: (status: ReadingSessionStatus) => void;
}

export interface ReadingSession {
  /** Stop listening and get the aggregated result. */
  stop(): Promise<ReadingAssessmentResult>;
  /** Abandon the session: release the mic, discard everything. */
  cancel(): void;
}

/* ── Raw Azure response shapes (subset we consume) ─────────────────────── */

interface AzureWord {
  Word: string;
  Offset?: number; // 100-ns ticks
  Duration?: number; // 100-ns ticks
  PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string };
  Phonemes?: { Phoneme?: string; PronunciationAssessment?: { AccuracyScore?: number } }[];
}

interface AzureSegment {
  DisplayText?: string;
  NBest?: {
    Words?: AzureWord[];
    PronunciationAssessment?: {
      AccuracyScore?: number;
      FluencyScore?: number;
      CompletenessScore?: number;
      PronScore?: number;
      ProsodyScore?: number;
    };
  }[];
}

const TICKS_PER_MS = 10_000;

/* ── Token fetch (cached 4 min so sessions start ≥6 min from expiry) ───── */

const TOKEN_CACHE_MS = 4 * 60 * 1000;
const TOKEN_REFRESH_MS = 4 * 60 * 1000;

let cachedToken: { token: string; region: string; expiresAt: number } | null = null;

async function fetchSpeechToken(authToken?: string | null): Promise<{ token: string; region: string }> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken;
  const res = await fetch('/api/speech/token', {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
    cache: 'no-store',
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string; hint?: string };
      detail = body.hint || body.error || '';
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail || `Speech token request failed (${res.status}).`);
  }
  const { token, region } = (await res.json()) as { token: string; region: string };
  cachedToken = { token, region, expiresAt: Date.now() + TOKEN_CACHE_MS };
  return cachedToken;
}

/** Drop the cached Azure token (e.g. after a connection/auth error). */
export function clearSpeechTokenCache(): void {
  cachedToken = null;
}

/* ── Word extraction ───────────────────────────────────────────────────── */

function toWordScores(segment: AzureSegment): WordScore[] {
  const words = segment.NBest?.[0]?.Words ?? [];
  return words.map((w) => ({
    word: w.Word,
    accuracy: w.PronunciationAssessment?.AccuracyScore ?? null,
    // No assessment block at all → 'Unassessed', so the word is excluded from
    // both the accuracy mean and the completeness numerator (defaulting to
    // 'None' would count it as read-correctly while scoring it 0).
    errorType: w.PronunciationAssessment ? (w.PronunciationAssessment.ErrorType ?? 'None') : 'Unassessed',
    offsetMs: w.Offset != null ? w.Offset / TICKS_PER_MS : null,
    durationMs: w.Duration != null ? w.Duration / TICKS_PER_MS : null,
    phonemes: (w.Phonemes ?? []).map((p) => ({
      phoneme: p.Phoneme ?? '',
      accuracy: p.PronunciationAssessment?.AccuracyScore ?? null,
    })),
  }));
}

/* ── Reference alignment (continuous-mode miscue detection) ────────────── */

/** Lowercase and strip leading/trailing punctuation ("Sun!" → "sun").
 *  Curly apostrophes fold to ASCII — reference text is typeset ("don’t"),
 *  Azure's recognized words are not ("don't"); without the fold a correctly
 *  read contraction misaligns into a synthetic Omission + Insertion. */
function normalizeToken(t: string): string {
  return t.replace(/[’ʼ]/g, "'").toLowerCase().replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
}

function tokenizeReference(referenceText: string): string[] {
  return referenceText.split(/\s+/).map(normalizeToken).filter(Boolean);
}

function omissionOf(word: string): WordScore {
  return { word, accuracy: null, errorType: 'Omission', offsetMs: null, durationMs: null, phonemes: [] };
}

/* LCS diff of reference tokens vs recognized words (O(n·m); passages are a
 * few hundred words at most). Matched words keep the service's assessment;
 * unmatched reference words become synthetic Omissions; unmatched recognized
 * words (re-reads, made-up words) are relabeled Insertion.                  */
function alignWords(referenceTokens: string[], recognized: WordScore[]): WordScore[] {
  const recTokens = recognized.map((w) => normalizeToken(w.word));
  const n = referenceTokens.length;
  const m = recTokens.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        referenceTokens[i] === recTokens[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const aligned: WordScore[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (referenceTokens[i] === recTokens[j]) {
      aligned.push(recognized[j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      aligned.push(omissionOf(referenceTokens[i]));
      i++;
    } else {
      aligned.push({ ...recognized[j], errorType: 'Insertion' });
      j++;
    }
  }
  for (; i < n; i++) aligned.push(omissionOf(referenceTokens[i]));
  for (; j < m; j++) aligned.push({ ...recognized[j], errorType: 'Insertion' });
  return aligned;
}

/* ── Aggregation ───────────────────────────────────────────────────────── */

const round1 = (n: number) => Math.round(n * 10) / 10;

/* Passage-level scores, following Microsoft's continuous-assessment recipe:
 *   words        = recognized words LCS-aligned against the reference text
 *                  (the service omits miscue labels in continuous mode)
 *   accuracy     = mean AccuracyScore over non-Insertion, assessed words;
 *                  omissions count as 0, so skipped words hurt the score
 *   fluency      = duration-weighted mean of segment FluencyScores
 *   prosody      = mean of segment ProsodyScores (when present)
 *   completeness = reference words read correctly / reference word count
 *   pronunciation = docs' scripted-assessment weights: 0.4/0.2/0.2/0.2
 *                   (accuracy/prosody/fluency/completeness) with prosody,
 *                   0.5/0.25/0.25 without.                                  */
/* Exported so saved raw segments (ReadingAssessmentResult.raw) can be
 * re-scored offline while tuning, and so tests can exercise the real code. */
export function aggregate(segments: AzureSegment[], referenceText: string): { scores: ReadingScores; words: WordScore[] } {
  const referenceTokens = tokenizeReference(referenceText);
  const recognized = segments.flatMap(toWordScores);
  const words = alignWords(referenceTokens, recognized);

  const scored = words.filter((w) => w.errorType !== 'Insertion' && w.errorType !== 'Unassessed');
  const accuracy = scored.length ? scored.reduce((s, w) => s + (w.accuracy ?? 0), 0) / scored.length : 0;

  let fluencyWeighted = 0;
  let fluencyWeightTotal = 0;
  const prosodyScores: number[] = [];
  for (const seg of segments) {
    const pa = seg.NBest?.[0]?.PronunciationAssessment;
    if (!pa) continue;
    const segWords = (seg.NBest?.[0]?.Words ?? []).filter((w) => w.Offset != null && w.Duration != null);
    const first = segWords[0];
    const last = segWords[segWords.length - 1];
    const weight = first && last ? (last.Offset! + last.Duration! - first.Offset!) / TICKS_PER_MS : 0;
    if (pa.FluencyScore != null && weight > 0) {
      fluencyWeighted += pa.FluencyScore * weight;
      fluencyWeightTotal += weight;
    }
    if (pa.ProsodyScore != null) prosodyScores.push(pa.ProsodyScore);
  }
  const fluency = fluencyWeightTotal > 0 ? fluencyWeighted / fluencyWeightTotal : 0;
  const prosody = prosodyScores.length ? prosodyScores.reduce((a, b) => a + b, 0) / prosodyScores.length : null;

  const readCorrectly = words.filter((w) => w.errorType === 'None').length;
  const completeness = referenceTokens.length ? Math.min(100, (readCorrectly / referenceTokens.length) * 100) : 0;

  const pronunciation =
    prosody != null
      ? accuracy * 0.4 + prosody * 0.2 + fluency * 0.2 + completeness * 0.2
      : accuracy * 0.5 + fluency * 0.25 + completeness * 0.25;

  return {
    scores: {
      pronunciation: round1(pronunciation),
      accuracy: round1(accuracy),
      fluency: round1(fluency),
      completeness: round1(completeness),
      prosody: prosody != null ? round1(prosody) : null,
    },
    words,
  };
}

/* ── WAV capture (for the decoding grader) ─────────────────────────────── */

function encodeWavPcm16(chunks: Float32Array[], sampleRate: number): Blob {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const s = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/* ── Session ───────────────────────────────────────────────────────────── */

export async function startReadingSession(opts: ReadingSessionOptions): Promise<ReadingSession> {
  const locale = opts.locale ?? 'en-US';
  const referenceText = opts.referenceText.trim();
  if (!referenceText) throw new Error('referenceText is empty.');
  const status = (s: ReadingSessionStatus) => opts.onStatus?.(s);
  status('connecting');

  // Token + SDK first — fail fast before we touch the mic. Dynamic import
  // keeps the ~1 MB SDK out of every other page's bundle and off the server.
  const [{ token, region }, sdk] = await Promise.all([
    fetchSpeechToken(opts.authToken),
    import('microsoft-cognitiveservices-speech-sdk'),
  ]);

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
  } catch (e) {
    status('error');
    throw new Error(
      e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
        ? 'Microphone permission was denied. Allow mic access and try again.'
        : `Could not open the microphone: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
  speechConfig.speechRecognitionLanguage = locale;
  // Kid-friendly pacing: wait long before giving up on the first word, and
  // don't split the passage on every thinking-pause between words.
  speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, '15000');
  speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, '2200');

  const paConfig = new sdk.PronunciationAssessmentConfig(
    referenceText,
    sdk.PronunciationAssessmentGradingSystem.HundredMark,
    sdk.PronunciationAssessmentGranularity.Phoneme,
    /* enableMiscue */ true, // labels only apply per-segment; aggregate() re-aligns
  );
  paConfig.phonemeAlphabet = 'IPA';
  if (locale.toLowerCase().startsWith('en')) paConfig.enableProsodyAssessment = true;

  const audioConfig: AudioConfig = sdk.AudioConfig.fromStreamInput(stream);
  const recognizer: SpeechRecognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
  paConfig.applyTo(recognizer);

  // Raw PCM tap for the decoding grader (MediaRecorder's webm/opus won't do).
  // ScriptProcessor is deprecated but universal and needs no worklet file;
  // capture runs at the context's native rate — the MDD service resamples.
  let wavContext: AudioContext | null = null;
  let wavNodes: { source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode } | null = null;
  const wavChunks: Float32Array[] = [];
  try {
    wavContext = new AudioContext();
    // Autoplay policies can hand back a suspended context even inside a
    // click handler (Safari); resume is a no-op when already running.
    void wavContext.resume().catch(() => {});
    const source = wavContext.createMediaStreamSource(stream);
    const processor = wavContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      wavChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    source.connect(processor);
    processor.connect(wavContext.destination); // required by some browsers to fire onaudioprocess
    wavNodes = { source, processor };
  } catch {
    wavContext = null; // decoding grader just won't run for this session
  }

  // Local playback copy. Best-effort: Safari records mp4, Chrome/Firefox webm.
  let recorder: MediaRecorder | null = null;
  const chunks: BlobPart[] = [];
  try {
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(
      (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
    );
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.start(1000);
  } catch {
    recorder = null; // assessment works without the playback copy
  }

  // Recorder blob: resolve on the recorder's own stop event.
  const audioPromise: Promise<Blob | null> = recorder
    ? new Promise((resolve) => {
        const r = recorder!;
        const finish = () => resolve(chunks.length ? new Blob(chunks, { type: r.mimeType || 'audio/webm' }) : null);
        r.onstop = finish;
        r.onerror = () => resolve(null);
      })
    : Promise.resolve(null);

  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let released = false;
  let audioWav: Blob | null = null;
  const releaseHardware = () => {
    if (released) return;
    released = true;
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (wavContext) {
      try {
        wavNodes?.processor.disconnect();
        wavNodes?.source.disconnect();
        if (wavChunks.length) audioWav = encodeWavPcm16(wavChunks, wavContext.sampleRate);
        void wavContext.close();
      } catch {
        /* wav capture is best-effort */
      }
      wavContext = null;
    }
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } catch {
      /* already stopped */
    }
    stream.getTracks().forEach((t) => t.stop());
  };

  const segments: AzureSegment[] = [];
  const transcriptParts: string[] = [];
  let fatalError: string | null = null;
  const startedAt = performance.now();

  recognizer.recognizing = (_s, e) => {
    if (e.result.text) opts.onPartialTranscript?.(e.result.text);
  };
  recognizer.recognized = (_s, e) => {
    if (e.result.reason !== sdk.ResultReason.RecognizedSpeech) return;
    const json = e.result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult);
    if (!json) return;
    try {
      const segment = JSON.parse(json) as AzureSegment;
      segments.push(segment);
      if (segment.DisplayText) transcriptParts.push(segment.DisplayText);
      opts.onSegment?.(toWordScores(segment));
    } catch {
      /* malformed segment JSON — skip it */
    }
  };
  recognizer.canceled = (_s, e) => {
    if (e.reason !== sdk.CancellationReason.Error) return;
    // Recognition is permanently dead at this point (the SDK does not
    // reconnect), so free the mic and tell the caller right away instead of
    // sitting in 'listening' with a hot microphone. Token expiry surfaces
    // here as ConnectionFailure (not AuthenticationFailure), so always drop
    // the cached token.
    fatalError = e.errorDetails || 'Speech service connection failed.';
    clearSpeechTokenCache();
    releaseHardware();
    status('error');
  };

  await new Promise<void>((resolve, reject) => {
    recognizer.startContinuousRecognitionAsync(resolve, (err) => {
      releaseHardware();
      recognizer.close();
      status('error');
      reject(new Error(`Could not start recognition: ${err}`));
    });
  });
  status('listening');

  // Long sessions outlive the ~10-min token: push a fresh one onto the live
  // recognizer every 4 min. Failures keep the old token — if it then expires,
  // the canceled handler above surfaces the real error.
  refreshTimer = setInterval(() => {
    void fetchSpeechToken(opts.authToken)
      .then(({ token: fresh }) => {
        recognizer.authorizationToken = fresh;
      })
      .catch(() => {});
  }, TOKEN_REFRESH_MS);

  const stopRecognizer = () =>
    new Promise<void>((resolve) => recognizer.stopContinuousRecognitionAsync(resolve, () => resolve()));

  return {
    async stop(): Promise<ReadingAssessmentResult> {
      if (!fatalError) status('stopping');
      await stopRecognizer();
      releaseHardware();
      recognizer.close();
      const audio = await audioPromise;
      if (fatalError && segments.length === 0) {
        status('error');
        throw new Error(fatalError);
      }
      const { scores, words } = aggregate(segments, referenceText);
      status(fatalError ? 'error' : 'done');
      return {
        scores,
        words,
        transcript: transcriptParts.join(' '),
        referenceText,
        audio,
        audioWav,
        durationMs: Math.round(performance.now() - startedAt),
        warning: fatalError
          ? `The connection failed mid-reading (${fatalError}) — these scores only cover the part that was assessed.`
          : null,
        raw: segments,
      };
    },
    cancel(): void {
      void stopRecognizer().then(() => recognizer.close());
      releaseHardware();
      status('done');
    },
  };
}
