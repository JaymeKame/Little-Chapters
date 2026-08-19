'use client';

/* Voice + story-audio infrastructure for Little Chapters.
 *
 * REMOVED: this file previously played a continuous synthesized Web Audio
 * oscillator drone as "ambience" plus synthesized sine-tone "cues" (the
 * constant "oooo" sound). That was not acceptable product audio and has
 * been deleted entirely — there is no oscillator/procedural-tone code left
 * anywhere in this file.
 *
 * Current behavior:
 *  - speakPrompt()/stopSpeaking() use the browser's real Web Speech API
 *    (speechSynthesis) for voice — a legitimate system service, not a
 *    synthesized placeholder.
 *  - playTheme()/playAmbience()/playMusic()/playUISound() are asset-based: they play a
 *    real audio file (HTMLAudioElement) at the given path if one exists.
 *    If the asset is missing (404/decode/autoplay-block error), they fail
 *    SILENTLY — no fallback tone is generated. Silence is correct behavior
 *    until real audio assets are added under public/audio/.
 *  - duckAmbience()/restoreAmbience() lower ambience under speech/listening
 *    so speech always wins.
 *
 * All current assets are flat under public/audio/; missing assets fail silently.
 */

import type { Chapter } from './chapters';

/* ── Voice (TTS) ──────────────────────────────────────────────────────── */

export function speakPrompt(
  text: string,
  opts?: { rate?: number; pitch?: number; onEnd?: () => void },
): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel(); // one voice line at a time
    const u = new SpeechSynthesisUtterance(text);
    u.rate = opts?.rate ?? 0.95; // slightly slower — early readers, not adults
    u.pitch = opts?.pitch ?? 1.05;
    if (opts?.onEnd) {
      u.onend = opts.onEnd;
      u.onerror = opts.onEnd; // blocked/unsupported mid-utterance — still clear the "speaking" state
    }
    window.speechSynthesis.speak(u);
  } catch {
    /* speechSynthesis unsupported/blocked — voice is a nice-to-have, never fatal */
  }
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
}

/** Chapter-aware welcome line for Screen 3 (falls back to a generic line if
 *  no chapter is available yet). */
export function welcomeLine(childName: string, chapter?: Chapter | null, alreadyRead = false): string {
  if (alreadyRead) return `You already read today's chapter, ${childName}! Come back tomorrow for a new one.`;
  if (chapter) return `Ready to see what happens to ${chapter.character} today, ${childName}?`;
  return `Hi ${childName}, your new chapter is ready.`;
}

/* ── Ambience / music / UI sound (asset-based; silent if asset missing) ─ */

const AUDIO_VOLUMES = {
  theme: 0.045,
  ambience: 0.03,
  music: 0.18,
  ui: 0.28,
  duckFactor: 0.35,
} as const;

let themeEl: HTMLAudioElement | null = null;
let themeAsset: string | null = null;
let musicEl: HTMLAudioElement | null = null;
let ambienceEl: HTMLAudioElement | null = null;
let ambienceAsset: string | null = null;
let ducked = false;
const fadeTimers = new Map<HTMLAudioElement, ReturnType<typeof setInterval>>();

function audioLog(message: string): void {
  if (process.env.NODE_ENV === 'development') console.info(`[Audio] ${message}`);
}

function fadeElement(el: HTMLAudioElement | null, target: number): void {
  if (!el) return;
  const previous = fadeTimers.get(el);
  if (previous) clearInterval(previous);
  const start = el.volume;
  const steps = 8;
  let step = 0;
  const timer = setInterval(() => {
    step += 1;
    el.volume = start + ((target - start) * step) / steps;
    if (step >= steps) {
      clearInterval(timer);
      fadeTimers.delete(el);
    }
  }, 25);
  fadeTimers.set(el, timer);
}

function clearTrack(el: HTMLAudioElement | null): void {
  if (!el) return;
  el.pause();
  el.removeAttribute('src');
  el.load();
}

export function themeAssetFor(interest: string | undefined): string | null {
  const allowed = new Set(['dogs', 'space', 'ocean', 'unicorns', 'dinosaurs', 'trains']);
  return interest && allowed.has(interest) ? `/audio/${interest}.mp3` : null;
}

export function prepareStoryAudio(theme: string | null | undefined): void {
  if (typeof window === 'undefined' || !theme || (themeEl && themeAsset === theme)) return;
  stopTheme();
  try {
    const el = new Audio(theme);
    el.loop = true;
    el.preload = 'auto';
    el.volume = 0;
    el.addEventListener('error', () => stopTheme(), { once: true });
    themeEl = el;
    themeAsset = theme;
  } catch {
    /* silent */
  }
}

export function playTheme(): void {
  if (!themeEl) return;
  themeEl.volume = ducked ? AUDIO_VOLUMES.theme * AUDIO_VOLUMES.duckFactor : AUDIO_VOLUMES.theme;
  void themeEl.play().then(() => audioLog(`theme -> ${themeAsset?.replace('/audio/', '').replace('.mp3', '')}`)).catch(() => {});
}

export function stopTheme(): void {
  const timer = themeEl ? fadeTimers.get(themeEl) : undefined;
  if (timer) clearInterval(timer);
  if (themeEl) fadeTimers.delete(themeEl);
  clearTrack(themeEl);
  themeEl = null;
  themeAsset = null;
}

/** Path convention for a chapter's ambience track — swap in a real file at
 *  this path and it plays automatically; until then, play() fails silently. */
export function ambienceAssetFor(kind: Chapter['ambience']): string {
  const map: Partial<Record<Chapter['ambience'], string>> = {
    farm: '/audio/dogs.mp3',
    countryside: '/audio/trains.mp3',
    space: '/audio/space.mp3',
    ocean: '/audio/ocean.mp3',
    fantasy: '/audio/unicorns.mp3',
    jungle: '/audio/dinosaurs.mp3',
  };
  return map[kind] ?? '';
}

/** Plays a looping ambience track from a real audio file. No-op (silent) if
 *  the asset does not exist — never generates a substitute tone. */
export function playAmbience(asset: string | null | undefined): void {
  if (typeof window === 'undefined' || !asset) return;
  if (ambienceAsset === asset && ambienceEl) return; // already prepared/playing this track
  stopAmbience();
  try {
    const el = new Audio(asset);
    el.loop = true;
    el.volume = ducked ? AUDIO_VOLUMES.ambience * AUDIO_VOLUMES.duckFactor : AUDIO_VOLUMES.ambience;
    el.addEventListener('error', () => stopAmbience()); // missing/unsupported asset — stay silent
    void el.play().catch(() => {}); // autoplay-blocked — user interaction can call playAmbience again
    ambienceEl = el;
    ambienceAsset = asset;
  } catch {
    /* silent */
  }
}

export function stopAmbience(): void {
  const timer = ambienceEl ? fadeTimers.get(ambienceEl) : undefined;
  if (timer) clearInterval(timer);
  if (ambienceEl) fadeTimers.delete(ambienceEl);
  clearTrack(ambienceEl);
  ambienceEl = null;
  ambienceAsset = null;
}

export function setAmbienceVolume(volume: number): void {
  const next = Math.max(0, Math.min(0.12, volume));
  if (ambienceEl) ambienceEl.volume = ducked ? next * 0.18 : next;
}

/** Speech always wins: duck ambience while the child/AI/help audio plays. */
export function duckAmbience(): void {
  ducked = true;
  fadeElement(themeEl, AUDIO_VOLUMES.theme * AUDIO_VOLUMES.duckFactor);
  fadeElement(ambienceEl, AUDIO_VOLUMES.ambience * AUDIO_VOLUMES.duckFactor);
  audioLog('duck -> listening');
}

export function restoreAmbience(): void {
  ducked = false;
  fadeElement(themeEl, AUDIO_VOLUMES.theme);
  fadeElement(ambienceEl, AUDIO_VOLUMES.ambience);
  audioLog('restore');
}

/** A short one-shot musical moment (e.g. the cliffhanger cue). Silent no-op
 *  if the asset is missing — never synthesized. */
export function playMusic(asset: string | null | undefined): void {
  if (typeof window === 'undefined' || !asset) return;
  stopMusic();
  try {
    const el = new Audio(asset);
    el.volume = AUDIO_VOLUMES.music;
    el.addEventListener('ended', () => stopMusic(), { once: true });
    musicEl = el;
    void el.play().catch(() => stopMusic());
  } catch {
    /* silent */
  }
}

export function stopMusic(): void {
  clearTrack(musicEl);
  musicEl = null;
}

/** A tiny quiet UI sound (listening-start, word-success). Silent no-op if
 *  the asset is missing — no negative/"wrong" sound exists on purpose. */
export function playUISound(asset: string | null | undefined): void {
  if (typeof window === 'undefined' || !asset) return;
  try {
    const el = new Audio(asset);
    el.volume = AUDIO_VOLUMES.ui;
    el.addEventListener('ended', () => clearTrack(el), { once: true });
    void el.play().then(() => audioLog(asset.replace('/audio/', ''))).catch(() => {});
  } catch {
    /* silent */
  }
}

export function playHomeSound(asset: 'play.mp3' | 'replay.mp3' | 'tap-soft.mp3' | 'close.mp3'): void {
  playUISound(`/audio/${asset}`);
}

export function playReadingCue(asset: 'section-success.mp3' | 'page-turn.mp3'): void {
  playUISound(`/audio/${asset}`);
  if (asset === 'section-success.mp3') audioLog('section-success');
  if (asset === 'page-turn.mp3') audioLog('page-turn');
}

export function playListeningStart(): void {
  playUISound('/audio/listening-start.mp3');
  audioLog('listening-start');
}

export function playCliffhanger(): void {
  playMusic('/audio/cliffhanger.mp3');
  audioLog('cliffhanger');
}

