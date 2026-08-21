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
 *  - speakPrompt()/stopSpeaking() use either ElevenLabs (when
 *    NEXT_PUBLIC_VOICE_PROVIDER=elevenlabs) or the browser's Web Speech API.
 *    The ElevenLabs path fetches audio/mpeg from POST /api/speech/model and
 *    plays it via HTMLAudioElement; it falls back silently to Web Speech on
 *    any network or autoplay error. The public function signatures are
 *    unchanged — callers do not need to know which provider is active.
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

/* NEXT_PUBLIC_ vars are inlined at build time by the Next.js bundler — this
 * module-level constant makes that static nature explicit to future readers. */
const VOICE_PROVIDER = process.env.NEXT_PUBLIC_VOICE_PROVIDER;

/* ── Voice (TTS) ──────────────────────────────────────────────────────── */

/** Module-level handle for a currently-playing ElevenLabs audio clip so
 *  stopSpeaking() can cancel it synchronously. */
let _elevenLabsEl: HTMLAudioElement | null = null;

/** Internal: play text via POST /api/speech/model (ElevenLabs stream).
 *  Falls back to Web Speech API on any failure so callers are never blocked. */
function _speakElevenLabs(
  text: string,
  opts?: { onEnd?: () => void },
): void {
  // Cancel any in-flight ElevenLabs utterance first.
  if (_elevenLabsEl) {
    _elevenLabsEl.pause();
    _elevenLabsEl = null;
  }
  fetch('/api/speech/model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`model route ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const el = new Audio(url);
      _elevenLabsEl = el;
      const cleanup = () => {
        URL.revokeObjectURL(url);
        if (_elevenLabsEl === el) _elevenLabsEl = null;
      };
      el.addEventListener('ended', () => { cleanup(); opts?.onEnd?.(); }, { once: true });
      el.addEventListener('error', () => { cleanup(); opts?.onEnd?.(); }, { once: true });
      void el.play().catch(() => { cleanup(); opts?.onEnd?.(); });
    })
    .catch(() => {
      // ElevenLabs path failed — fall back to Web Speech so the child is not
      // left in silence.
      _speakWebSpeech(text, opts);
    });
}

/** Internal: speak via the browser's Web Speech API (original path). */
function _speakWebSpeech(
  text: string,
  opts?: { rate?: number; pitch?: number; onEnd?: () => void },
): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
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

export function speakPrompt(
  text: string,
  opts?: { rate?: number; pitch?: number; onEnd?: () => void },
): void {
  if (typeof window === 'undefined') return;
  // A backgrounded tab must never start speaking — this guards against a
  // delayed callback (e.g. an async chapter-load resolving after the child
  // has already switched apps) firing speakPrompt() while hidden.
  if (typeof document !== 'undefined' && document.hidden) return;

  if (VOICE_PROVIDER === 'elevenlabs') {
    _speakElevenLabs(text, opts);
  } else {
    _speakWebSpeech(text, opts);
  }
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
  if (_elevenLabsEl) {
    _elevenLabsEl.pause();
    _elevenLabsEl = null;
  }
}

/** Chapter-aware welcome line for Screen 3 (falls back to a generic line if
 *  no chapter is available yet). `alreadyRead` covers the "came back later
 *  today" case — no chapter prompt, since there isn't a new one to start. */
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
  if (typeof document !== 'undefined' && document.hidden) return; // see speakPrompt()'s guard for why
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
  if (typeof document !== 'undefined' && document.hidden) return; // see speakPrompt()'s guard for why
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

/** Tab/app backgrounded (visibilitychange -> hidden, or pagehide): pause
 *  every playing track and cancel speech immediately. Deliberately does NOT
 *  clear themeEl/ambienceEl/musicEl — that would drop the loaded asset and
 *  force a reload on return. Also deliberately has no matching "resume"
 *  counterpart here: whether anything should come back is a decision only
 *  the current page/phase can make (see each page's visibilitychange
 *  handler), never this module guessing on its own. */
export function pauseForBackground(): void {
  stopSpeaking();
  for (const el of [themeEl, ambienceEl, musicEl]) {
    if (!el) continue;
    const timer = fadeTimers.get(el);
    if (timer) {
      clearInterval(timer);
      fadeTimers.delete(el);
    }
    el.pause();
  }
  audioLog('paused for background');
}

/** A short one-shot musical moment (e.g. the cliffhanger cue). Silent no-op
 *  if the asset is missing — never synthesized. */
export function playMusic(asset: string | null | undefined): void {
  if (typeof window === 'undefined' || !asset) return;
  if (typeof document !== 'undefined' && document.hidden) return; // see speakPrompt()'s guard for why
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

/** Resumes the currently-loaded one-shot (e.g. cliffhanger) from wherever
 *  pauseForBackground() left it — never restarts from 0, unlike calling
 *  playMusic() again. No-op if nothing is loaded, so it's safe for a page to
 *  call unconditionally on foregrounding without checking musicEl itself. */
export function resumeMusic(): void {
  if (!musicEl) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  void musicEl.play().catch(() => {});
}

export function stopMusic(): void {
  clearTrack(musicEl);
  musicEl = null;
}

/** A tiny quiet UI sound (listening-start, word-success). Silent no-op if
 *  the asset is missing — no negative/"wrong" sound exists on purpose. */
export function playUISound(asset: string | null | undefined): void {
  if (typeof window === 'undefined' || !asset) return;
  if (typeof document !== 'undefined' && document.hidden) return; // see speakPrompt()'s guard for why
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

/* ── Dev-only debug hook — never referenced by production UX, exists only
 * so a real-browser test can inspect actual playback state (module-level
 * Audio elements aren't in the DOM, so there's no other way to query them
 * from outside this file). Dead-code-eliminated from production bundles by
 * the same NODE_ENV check every other dev-only branch in this file uses. */
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as unknown as { __audioDebug: () => Record<string, unknown> }).__audioDebug = () => ({
    ducked,
    theme: themeEl && { asset: themeAsset, paused: themeEl.paused, volume: themeEl.volume },
    ambience: ambienceEl && { asset: ambienceAsset, paused: ambienceEl.paused, volume: ambienceEl.volume },
    music: musicEl && { paused: musicEl.paused, volume: musicEl.volume },
    speaking: typeof window.speechSynthesis !== 'undefined' && window.speechSynthesis.speaking,
    activeFadeTimers: fadeTimers.size,
  });
}

