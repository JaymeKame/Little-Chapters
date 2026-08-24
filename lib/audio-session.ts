'use client';

import {
  pauseForBackground,
  playCliffhanger,
  playHomeSound,
  playListeningStart,
  playReadingCue,
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
export interface AudioSessionEvent {
  type: 'mode' | 'speech-request' | 'speech-complete' | 'speech-cancel' | 'listening-start' | 'listening-stop' | 'background' | 'foreground' | 'provider';
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

  constructor() {
    subscribeVoiceTelemetry((provider) => {
      const event: AudioSessionEvent = { type: 'provider', mode: this.mode, at: Date.now(), provider };
      for (const listener of this.listeners) listener(event);
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  currentMode(): AudioSessionMode { return this.mode; }

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
    const start = () => {
      if (token !== this.speechToken) return;
      if (typeof document !== 'undefined' && document.hidden) { complete(); return; }
      speakPrompt(text, { rate: options.rate, pitch: options.pitch, onEnd: complete });
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(start);
    else start();
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
