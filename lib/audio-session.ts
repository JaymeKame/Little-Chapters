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

  speak(text: string, options: { purpose: string; rate?: number; pitch?: number; onEnd?: () => void }): void {
    this.cancelSpeech();
    const token = ++this.speechToken;
    // getUserMedia tracks are released synchronously by cancel(); yield one
    // animation frame before creating speaker output so iOS can switch routes.
    if (this.reading) { this.reading.cancel(); this.reading = null; }
    this.transition('speaking');
    this.emit('speech-request', options.purpose);
    const complete = exactlyOnce(() => {
      if (this.speechDone === complete) this.speechDone = null;
      this.transition('idle');
      this.emit('speech-complete', options.purpose);
      options.onEnd?.();
    });
    this.speechDone = complete;
    const performance = TUTOR_PERFORMANCE[tutorPurposeFor(options.purpose)];
    const start = () => {
      if (token !== this.speechToken) return;
      if (typeof document !== 'undefined' && document.hidden) { complete(); return; }
      speakPrompt(performText(text, performance), { rate: options.rate ?? performance.rate, pitch: options.pitch ?? performance.pitch, onEnd: complete });
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(start);
    else start();
  }

  /** Plays short pedagogical segments in order so a modeled word, its sound,
   * and the retry invitation retain distinct human pacing. The sequence owns
   * one cancellation token; no segment can leak after a newer utterance. */
  speakSequence(segments: Array<{ text: string; purpose: string }>, onEnd?: () => void): void {
    this.cancelSpeech();
    const sequenceToken = this.speechToken;
    const play = (index: number, expectedToken: number) => {
      if (expectedToken !== this.speechToken) return;
      const segment = segments[index];
      if (!segment) { onEnd?.(); return; }
      this.speak(segment.text, { purpose: segment.purpose, onEnd: () => {
        if (sequenceToken + index + 1 !== this.speechToken) return;
        const nextToken = this.speechToken;
        window.setTimeout(() => play(index + 1, nextToken), segment.purpose === 'phoneme-model' ? 280 : 160);
      } });
    };
    play(0, sequenceToken);
  }

  cancelSpeech(): void {
    this.speechToken += 1;
    if (!this.speechDone) { stopSpeaking(); return; }
    this.speechDone = null;
    stopSpeaking();
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
