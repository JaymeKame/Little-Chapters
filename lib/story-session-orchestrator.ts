'use client';

import { audioSession } from './audio-session';
import type { StoryInteractionBeat } from './story-interactions';

export interface StoryOrchestrationEvent {
  type: 'image-preload' | 'voice-preload' | 'beat-ready' | 'fallback';
  chapterId: string;
  beatId: string;
  latencyMs: number;
  cache?: 'hit' | 'miss';
  reason?: string;
}

type Listener = (event: StoryOrchestrationEvent) => void;
const listeners = new Set<Listener>();
const imageReady = new Set<string>();
const IMAGE_CACHE_PREFIX = 'little-chapters-scene-ready:';

export function subscribeStoryOrchestration(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: StoryOrchestrationEvent) {
  for (const listener of listeners) listener(event);
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    const debugWindow = window as unknown as { __storyOrchestration?: StoryOrchestrationEvent[] };
    debugWindow.__storyOrchestration = [...(debugWindow.__storyOrchestration ?? []).slice(-49), event];
  }
}

function preloadImage(chapterId: string, beatId: string, sceneId: string, url: string): Promise<void> {
  const key = `${chapterId}:${sceneId}:${url}`;
  const started = performance.now();
  const persisted = (() => { try { return localStorage.getItem(IMAGE_CACHE_PREFIX + key) === '1'; } catch { return false; } })();
  if (imageReady.has(key)) {
    emit({ type: 'image-preload', chapterId, beatId, latencyMs: 0, cache: 'hit' });
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const done = (cache: 'hit' | 'miss') => {
      if (settled) return;
      settled = true;
      imageReady.add(key);
      try { localStorage.setItem(IMAGE_CACHE_PREFIX + key, '1'); } catch { /* best effort */ }
      emit({ type: 'image-preload', chapterId, beatId, latencyMs: Math.round(performance.now() - started), cache });
      resolve();
    };
    image.onload = () => done(persisted ? 'hit' : 'miss');
    image.onerror = () => {
      if (settled) return;
      settled = true;
      emit({ type: 'fallback', chapterId, beatId, latencyMs: Math.round(performance.now() - started), reason: 'approved-scene-load-failed' });
      resolve();
    };
    image.src = url;
    if (image.complete && image.naturalWidth > 0) done('hit');
  });
}

/** One-beat lookahead. It warms media only; AudioSession retains playback ownership. */
export async function prepareStoryBeat(chapterId: string, beat: StoryInteractionBeat, approvedSceneUrl: string, timeoutMs = 2500): Promise<void> {
  const started = performance.now();
  const voice = audioSession.preloadSpeech(beat.spokenInstruction, `${beat.beatId}-lookahead`).then((cache) => {
    emit({ type: 'voice-preload', chapterId, beatId: beat.beatId, latencyMs: Math.round(performance.now() - started), cache: cache === 'hit' ? 'hit' : 'miss', reason: cache === 'unavailable' ? 'provider-unavailable' : undefined });
  });
  const media = Promise.all([preloadImage(chapterId, beat.beatId, beat.visualSceneId, approvedSceneUrl), voice]);
  await Promise.race([media, new Promise<void>((resolve) => setTimeout(() => {
    emit({ type: 'fallback', chapterId, beatId: beat.beatId, latencyMs: timeoutMs, reason: 'lookahead-timeout' });
    resolve();
  }, timeoutMs))]);
  emit({ type: 'beat-ready', chapterId, beatId: beat.beatId, latencyMs: Math.round(performance.now() - started) });
}
