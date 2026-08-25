'use client';

import {
  pauseForBackground,
  playCliffhanger,
  playHomeSound,
  playListeningStart,
  playReadingCue,
  prefetchPrompt,
  playTheme,
  prepareStoryAudio,
  restoreAmbience,
  resumeMusic,
  setMusicPolicy,
  speakPrompt,
  stopMusic,
  stopSpeaking,
  stopTheme,
  duckAmbience,
  subscribeVoiceTelemetry,
} from './audio';
import { startReadingSession, type ReadingSession, type ReadingSessionOptions } from './pronunciation';
import { exactlyOnce } from './exactly-once';
export { exactlyOnce } from './exactly-once';

export type AudioSessionMode = 'idle' | 'speaking' | 'listening' | 'processing' | 'backgrounded';
export type MusicPreference = 'off' | 'low' | 'normal';
export type TutorPurpose = 'story-intro' | 'instruction' | 'phoneme-model' | 'word-blend' | 'retry' | 'encouragement' | 'prediction' | 'discovery' | 'celebration' | 'cliffhanger';
export interface TutorPerformance { rate: number; pitch: number; pauseStyle: 'natural' | 'clear' | 'deliberate' | 'bright' | 'suspense' }
export const TUTOR_PERFORMANCE: Record<TutorPurpose, TutorPerformance> = {
  'story-intro': { rate: .9, pitch: 1.02, pauseStyle: 'natural' },
  instruction: { rate: .86, pitch: 1, pauseStyle: 'clear' },
  'phoneme-model': { rate: .72, pitch: 1, pauseStyle: 'deliberate' },
  'word-blend': { rate: .82, pitch: 1.01, pauseStyle: 'deliberate' },
  retry: { rate: .86, pitch: 1, pauseStyle: 'clear' },
  encouragement: { rate: .92, pitch: 1.04, pauseStyle: 'bright' },
  prediction: { rate: .9, pitch: 1.03, pauseStyle: 'natural' },
  discovery: { rate: .9, pitch: 1.04, pauseStyle: 'bright' },
  celebration: { rate: .96, pitch: 1.06, pauseStyle: 'bright' },
  cliffhanger: { rate: .82, pitch: 1.01, pauseStyle: 'suspense' },
};

export function tutorPurposeFor(purpose: string): TutorPurpose {
  if (/phoneme|sound-hunt-retry/.test(purpose)) return 'phoneme-model';
  if (/blend|word-builder/.test(purpose)) return 'word-blend';
  if (/retry/.test(purpose)) return 'retry';
  if (/prediction/.test(purpose)) return 'prediction';
  if (/celebr|success|praise/.test(purpose)) return 'celebration';
  if (/cliff|ending|final-story/.test(purpose)) return 'cliffhanger';
  if (/welcome|intro/.test(purpose)) return 'story-intro';
  if (/instruction|prompt|help/.test(purpose)) return 'instruction';
  return 'encouragement';
}

function performText(text: string, performance: TutorPerformance): string {
  if (performance.pauseStyle === 'suspense') return text.replace(/([,.!?])\s*/g, '$1 … ');
  if (performance.pauseStyle === 'deliberate') return text.replace(/\s*\+\s*/g, ' … ');
  return text;
}
export interface AudioSessionEvent {
  type: 'mode' | 'speech-request' | 'speech-preload' | 'speech-complete' | 'speech-cancel' | 'listening-start' | 'listening-stop' | 'background' | 'foreground' | 'provider';
  mode: AudioSessionMode;
  at: number;
  purpose?: string;
  provider?: Record<string, unknown>;
}

type Listener = (event: AudioSessionEvent) => void;

export class AudioSessionController {
  private mode: AudioSessionMode = 'idle';
  private listeners = new Set<Listener>();
  private speechDone: (() => void) | null = null;
  private speechToken = 0;
  private reading: ReadingSession | null = null;
  private foregroundMode: Exclude<AudioSessionMode, 'backgrounded'> = 'idle';
  private lastProvider: Record<string, unknown> | null = null;

  constructor() {
    subscribeVoiceTelemetry((provider) => {
      this.lastProvider = provider;
      const event: AudioSessionEvent = { type: 'provider', mode: this.mode, at: Date.now(), provider };
      for (const listener of this.listeners) listener(event);
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  currentMode(): AudioSessionMode { return this.mode; }
  providerSnapshot(): Record<string, unknown> | null { return this.lastProvider ? { ...this.lastProvider } : null; }

  private emit(type: AudioSessionEvent['type'], purpose?: string): void {
    const event = { type, mode: this.mode, at: Date.now(), purpose };
    for (const listener of this.listeners) listener(event);
  }

  private transition(mode: AudioSessionMode): void {
    this.mode = mode;
    if (mode !== 'backgrounded') this.foregroundMode = mode;
    if (mode === 'speaking') duckAmbience();
    else if (mode === 'listening' || mode === 'processing') duckAmbience();
    else restoreAmbience();
    this.emit('mode');
  }

  setMusicPreference(preference: MusicPreference): void { setMusicPolicy(preference); }
  prepareTheme(asset: string | null): void { prepareStoryAudio(asset); }
  playTheme(): void { playTheme(); }
  stopTheme(): void { stopTheme(); }
  playHomeSound(asset: Parameters<typeof playHomeSound>[0]): void { playHomeSound(asset); }
  playReadingCue(asset: Parameters<typeof playReadingCue>[0]): void { playReadingCue(asset); }
  playCliffhanger(): void { playCliffhanger(); }
  stopMusic(): void { stopMusic(); }
  async preloadSpeech(text: string, purpose: string): Promise<'hit' | 'miss' | 'unavailable'> {
    const performance = TUTOR_PERFORMANCE[tutorPurposeFor(purpose)];
    const result = await prefetchPrompt(performText(text, performance), performance.rate);
    this.emit('speech-preload', `${purpose}:${result}`);
    return result;
  }

  speak(text: string, options: { purpose: string; rate?: number; pitch?: number; onEnd?: () => void; onSettle?: (status: 'ended' | 'cancelled') => void }): void {
    // Root cause of the "Listen → silence → dead game" deadlock: cancelSpeech()
    // used to drop this.speechDone without invoking it, so any onEnd owned by
    // the superseded call was lost. If a competing speak() (e.g., the final-
    // story-unlock prompt firing near a fresh interaction) interrupted a
    // speakSequence mid-stream, the sequence's outer onEnd never fired and
    // whatever gate depended on it (interactionReady, correctionSpeaking) stayed
    // closed forever. Fix here: expose an `onSettle` that ALWAYS fires exactly
    // once — either 'ended' (natural completion / provider error handled
    // downstream in lib/audio.ts's finish(true)) or 'cancelled' (a newer
    // speak/cancelSpeech superseded us). Callers who don't care about the
    // distinction can just use onEnd (fires on 'ended' only, unchanged
    // semantics). speakSequence below wires onSettle so its outer onEnd never
    // strands the UI.
    this.cancelSpeech();
    const token = ++this.speechToken;
    if (this.reading) { this.reading.cancel(); this.reading = null; }
    this.transition('speaking');
    this.emit('speech-request', options.purpose);
    let fired = false;
    const settle = (status: 'ended' | 'cancelled') => {
      if (fired) return;
      fired = true;
      if (this.speechDone === complete) this.speechDone = null;
      this.transition('idle');
      this.emit('speech-complete', options.purpose);
      if (status === 'ended') options.onEnd?.();
      options.onSettle?.(status);
    };
    // `complete` is the natural-completion path, still ref-identity-comparable
    // by cancelSpeech below so it can call settle('cancelled') instead.
    const complete = () => settle('ended');
    (complete as unknown as { settle: (status: 'ended' | 'cancelled') => void }).settle = settle;
    this.speechDone = complete;
    const performance = TUTOR_PERFORMANCE[tutorPurposeFor(options.purpose)];
    const start = () => {
      if (token !== this.speechToken) { settle('cancelled'); return; }
      if (typeof document !== 'undefined' && document.hidden) { complete(); return; }
      speakPrompt(performText(text, performance), { rate: options.rate ?? performance.rate, pitch: options.pitch ?? performance.pitch, onEnd: complete });
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(start);
    else start();
  }

  /** Plays short pedagogical segments in order so a modeled word, its sound,
   * and the retry invitation retain distinct human pacing. The sequence owns
   * one cancellation token; no segment can leak after a newer utterance.
   *
   * Per-segment `holdMs` (correction sprint Section 7) is used when present —
   * phoneme modeling / onset+rime need real listening time. Otherwise a
   * purpose-based default keeps the older callers behaving as before. */
  speakSequence(segments: Array<{ text: string; purpose: string; holdMs?: number }>, onEnd?: () => void): void {
    this.cancelSpeech();
    const sequenceToken = this.speechToken;
    // Outer onEnd MUST fire exactly once — either after the last segment,
    // or on interruption (a competing speak() / cancelSpeech()). Callers use
    // it to release UI gates (interactionReady, correctionSpeaking) and must
    // never be starved of it. See the audio-session speak() comment above.
    let settled = false;
    const settleOuter = () => { if (settled) return; settled = true; onEnd?.(); };
    const play = (index: number, expectedToken: number) => {
      if (expectedToken !== this.speechToken) { settleOuter(); return; }
      const segment = segments[index];
      if (!segment) { settleOuter(); return; }
      this.speak(segment.text, {
        purpose: segment.purpose,
        onSettle: (status) => {
          if (status === 'cancelled') { settleOuter(); return; }
          if (sequenceToken + index + 1 !== this.speechToken) { settleOuter(); return; }
          const nextToken = this.speechToken;
          const purposeHold = segment.purpose === 'phoneme-model'
            ? 440
            : segment.purpose === 'onset' || segment.purpose === 'rime' || segment.purpose === 'reference-word'
              ? 380
              : segment.purpose === 'word-blend'
                ? 320
                : 160;
          const hold = typeof segment.holdMs === 'number' && segment.holdMs >= 0 ? segment.holdMs : purposeHold;
          window.setTimeout(() => play(index + 1, nextToken), hold);
        },
      });
    };
    play(0, sequenceToken);
  }

  cancelSpeech(): void {
    this.speechToken += 1;
    const pending = this.speechDone;
    this.speechDone = null;
    stopSpeaking();
    // Route the previous pending completion through its settle('cancelled')
    // path so any onSettle-listening caller (speakSequence's outer onEnd,
    // useEffect watchdogs) hears about the interruption. Callers that used
    // only onEnd still see the old behavior (no fire on cancellation).
    // Without this, an interrupted sequence's outer onEnd was silently lost
    // — the "Listen → silence → dead game" deadlock.
    const settle = (pending as unknown as { settle?: (status: 'ended' | 'cancelled') => void } | null)?.settle;
    if (typeof settle === 'function') settle('cancelled');
    this.emit('speech-cancel');
    this.transition('idle');
  }

  async startListening(referenceText: string, options: Omit<ReadingSessionOptions, 'referenceText'>): Promise<ReadingSession> {
    this.cancelSpeech();
    this.reading?.cancel();
    this.reading = null;
    this.transition('listening');
    playListeningStart();
    this.emit('listening-start');
    let underlying: ReadingSession;
    try {
      underlying = await startReadingSession({ referenceText, ...options });
    } catch (error) {
      this.transition('idle');
      throw error;
    }
    const wrapped: ReadingSession = {
      stop: async () => {
        this.transition('processing');
        const result = await underlying.stop();
        if (this.reading === wrapped) this.reading = null;
        this.transition('idle');
        this.emit('listening-stop');
        return result;
      },
      cancel: () => {
        underlying.cancel();
        if (this.reading === wrapped) this.reading = null;
        this.transition('idle');
        this.emit('listening-stop');
      },
    };
    this.reading = wrapped;
    return wrapped;
  }

  setProductMode(mode: 'idle' | 'listening' | 'processing' | 'correction' | 'chapter-end'): void {
    if (this.mode === 'speaking' || this.mode === 'backgrounded') return;
    this.transition(mode === 'correction' ? 'listening' : mode === 'chapter-end' ? 'idle' : mode);
  }

  cancelAll(): void {
    this.cancelSpeech();
    this.reading?.cancel();
    this.reading = null;
    stopMusic();
    this.transition('idle');
  }

  background(): void {
    this.foregroundMode = this.mode === 'backgrounded' ? this.foregroundMode : this.mode;
    pauseForBackground();
    this.mode = 'backgrounded';
    this.emit('background');
  }

  foreground(): void {
    this.mode = this.foregroundMode === 'speaking' ? 'idle' : this.foregroundMode;
    if (this.mode === 'idle') restoreAmbience();
    if (this.mode === 'idle') playTheme();
    resumeMusic();
    this.emit('foreground');
  }
}

export const audioSession = new AudioSessionController();
