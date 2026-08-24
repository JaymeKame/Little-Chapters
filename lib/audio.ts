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
 *  - speakPrompt()/stopSpeaking() are the ONLY child-facing speech entry
 *    point in the app (every call site funnels through here — see
 *    docs/VOICE_CALLSITE_INVENTORY.md for the full audit). ElevenLabs is the
 *    default/normal provider: every call attempts it first. Browser Web
 *    Speech is resilience-fallback ONLY, used when ElevenLabs genuinely
 *    fails for that call (network error, timeout, non-2xx — including the
 *    server reporting ELEVENLABS_API_KEY isn't configured, which returns a
 *    fast 503, not a hang) or when NEXT_PUBLIC_VOICE_PROVIDER=web-speech
 *    explicitly forces it off (a deliberate escape hatch for local dev/
 *    testing the fallback path itself — see speakPrompt() below; this used
 *    to be inverted, requiring NEXT_PUBLIC_VOICE_PROVIDER=elevenlabs to
 *    OPT IN — a real 2026-08-21 bug: a deployment could have
 *    ELEVENLABS_API_KEY configured server-side and still silently run 100%
 *    Web Speech everywhere if that separate client-side flag was never set,
 *    with no error anywhere to notice). The ElevenLabs path fetches
 *    audio/mpeg from POST /api/speech/model and plays it via
 *    HTMLAudioElement, retrying once on a transient failure (network error
 *    or 5xx) before falling back — see _speakElevenLabs. The public
 *    function signatures are unchanged — callers do not need to know which
 *    provider is active.
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

/* Dev/preview-safe diagnostic, same pattern as app/read/page.tsx's
 * logVerdictDiagnostics(): console.debug rather than a NODE_ENV check, since
 * `next build` sets NODE_ENV=production on every Vercel deployment including
 * previews — a dev-only gate would make this invisible on exactly the
 * environment where "is ElevenLabs actually the thing that just played?"
 * needs answering. Chrome/Firefox DevTools hide Debug-level messages by
 * default, so this stays out of the way until deliberately switched on. */
/** Bounded history of recent voice events, newest last — the queryable form
 *  of the same data voiceLog() prints to the console. console.debug is easy
 *  to miss (hidden by default, and only useful while DevTools happens to be
 *  open at the right moment); a real test (Playwright, or a manual dev
 *  check) needs to ask "what actually just played?" after the fact, the
 *  same way __audioDebug below answers "what's the state of theme/ambience
 *  right now?" for module-level Audio elements that aren't in the DOM. */
const VOICE_LOG_MAX = 20;
const _voiceHistory: Record<string, unknown>[] = [];
const _voiceListeners = new Set<(event: Record<string, unknown>) => void>();

function voiceLog(event: Record<string, unknown>): void {
  const entry = { ...event, ts: Date.now() };
  console.debug('[Voice]', entry);
  _voiceHistory.push(entry);
  if (_voiceHistory.length > VOICE_LOG_MAX) _voiceHistory.shift();
  for (const listener of _voiceListeners) listener(entry);
}

export function subscribeVoiceTelemetry(listener: (event: Record<string, unknown>) => void): () => void {
  _voiceListeners.add(listener);
  return () => _voiceListeners.delete(listener);
}

/** ElevenLabs' turbo_v2 tends toward a flat, clipped read for input with no
 *  terminal punctuation — most noticeably on the SINGLE bare words the help
 *  ladder models in isolation (e.g. "chug"), which otherwise come out
 *  sounding like an isolated dictionary-pronunciation clip rather than a
 *  word spoken naturally. Giving every prompt a sentence-final full stop
 *  (when it doesn't already end in terminal punctuation) is a standard,
 *  low-risk neural-TTS prosody nudge — harmless for Web Speech too, so this
 *  applies to both providers rather than branching. Never changes what's
 *  AUDIBLY said, only how it's phrased for the synthesizer. */
function withTerminalPunctuation(text: string): string {
  const trimmed = text.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Module-level handle for a currently-playing ElevenLabs audio clip so
 *  stopSpeaking() can cancel it synchronously. */
let _elevenLabsEl: HTMLAudioElement | null = null;

/** Bumped on every speakPrompt() call AND every stopSpeaking() call. A
 *  _speakElevenLabs() call captures the value at its own start and checks it
 *  again right before playing — if another call (or an explicit stop) has
 *  since incremented it, this call is stale and must not play, even though
 *  its fetch/cache lookup already resolved. Without this, an in-flight
 *  fetch() from an OLDER speakPrompt() call can resolve after a newer call
 *  has already started (or after stopSpeaking() was called to silence
 *  everything), overwrite `_elevenLabsEl` without pausing the newer clip,
 *  and start playing stale audio on top of or after it — audible overlap,
 *  and audio stopSpeaking() can no longer reach. Paired with the
 *  AbortController below (network-level cancellation); this counter is the
 *  correctness guarantee even where abort() doesn't stop a callback from
 *  running (e.g. a cache hit, which is synchronous and has no request to
 *  abort). */
let _speechGeneration = 0;

/** In-flight ElevenLabs request, if any — aborted whenever a newer
 *  speakPrompt() call or an explicit stopSpeaking() supersedes it, so a slow
 *  or hung network request doesn't keep running (and doesn't keep `speaking`
 *  state alive) after the app has already moved on. */
let _elevenLabsAbort: AbortController | null = null;

/** A hung network must never leave the caller's onEnd() un-fired — the
 *  correction UI's "Try the word" button and the header replay button both
 *  gate on `speaking` flipping back to false, so a request that never
 *  resolves would strand the child on a permanently-disabled button. Well
 *  above ElevenLabs' normal 300-800ms round trip (see docs/VOICE_AND_PACING_AUDIT.md). */
const ELEVENLABS_TIMEOUT_MS = 8000;

/* Small in-memory cache for ElevenLabs clips, keyed by the exact synthesized
 * text. The help ladder and encouragement lines repeat often within a
 * session (config.json's encouragement_lines, common phonics words, the
 * welcome line) — without this, every repeat re-pays the full network +
 * synthesis round trip for audio that's byte-identical to one already
 * played seconds earlier. Session-lifetime only (module-level, no
 * persistence), capped so a long session can't grow this unboundedly. */
const ELEVENLABS_CACHE_MAX = 24;
const _elevenLabsCache = new Map<string, Blob>();

function _cacheGet(key: string): Blob | undefined {
  const hit = _elevenLabsCache.get(key);
  if (hit) {
    // Refresh recency (Map preserves insertion order) — simple LRU.
    _elevenLabsCache.delete(key);
    _elevenLabsCache.set(key, hit);
  }
  return hit;
}

function _cacheSet(key: string, blob: Blob): void {
  if (_elevenLabsCache.has(key)) _elevenLabsCache.delete(key);
  _elevenLabsCache.set(key, blob);
  if (_elevenLabsCache.size > ELEVENLABS_CACHE_MAX) {
    const oldest = _elevenLabsCache.keys().next().value;
    if (oldest !== undefined) _elevenLabsCache.delete(oldest);
  }
}

/** Internal: play text via POST /api/speech/model (ElevenLabs stream).
 *  Falls back to Web Speech API on any failure so callers are never blocked. */
function _speakElevenLabs(
  text: string,
  opts?: { onEnd?: () => void },
): void {
  // This call supersedes anything still in flight — bump the generation
  // before doing anything else so a stale fetch/cache callback below (from a
  // PREVIOUS call) can recognize itself as superseded the instant it runs.
  _speechGeneration += 1;
  const myGeneration = _speechGeneration;

  // Cancel any in-flight ElevenLabs utterance/request first.
  if (_elevenLabsEl) {
    _elevenLabsEl.pause();
    _elevenLabsEl = null;
  }
  if (_elevenLabsAbort) {
    _elevenLabsAbort.abort();
    _elevenLabsAbort = null;
  }

  const playBlob = (blob: Blob) => {
    // Superseded by a newer speakPrompt()/stopSpeaking() while this clip was
    // being fetched (or pulled from cache) — never play it. Whatever call
    // superseded this one already owns onEnd; firing it again here would be
    // a second, unrequested callback for a request the caller has moved on
    // from.
    if (myGeneration !== _speechGeneration) return;
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
  };

  const cached = _cacheGet(text);
  if (cached) {
    voiceLog({ provider: 'elevenlabs', cache: 'hit', chars: text.length });
    playBlob(cached);
    return;
  }

  // One attempt: resolves with the audio blob, or throws an Error tagged
  // with `.retryable` — true for a transient blip (network-level failure,
  // our own client timeout, or ElevenLabs' own 502 in lib/elevenlabs.server.ts's
  // synthesize()), false for something retrying can't fix (503 = not
  // configured; 400 = bad request — the same text will fail the same way
  // every time). Kept as its own function so speakPrompt()'s single call
  // site (below) can retry once without duplicating the fetch/timeout
  // bookkeeping.
  function attempt(): Promise<Blob> {
    const controller = new AbortController();
    _elevenLabsAbort = controller;
    const timeout = setTimeout(() => controller.abort(), ELEVENLABS_TIMEOUT_MS);
    return fetch('/api/speech/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = new Error(`model route ${res.status}`) as Error & { retryable: boolean };
          err.retryable = res.status >= 500 && res.status !== 503; // 503 = not configured, static, never worth retrying
          throw err;
        }
        return res.blob();
      })
      .catch((err) => {
        if (err instanceof Error && 'retryable' in err) throw err; // already tagged above
        const tagged = err instanceof Error ? err : new Error(String(err));
        (tagged as Error & { retryable: boolean }).retryable = true; // network error or our own timeout (AbortError) — both transient
        throw tagged;
      })
      .finally(() => {
        clearTimeout(timeout);
        if (_elevenLabsAbort === controller) _elevenLabsAbort = null;
      });
  }

  function fallback(err: unknown, afterRetry: boolean): void {
    if (myGeneration !== _speechGeneration) return; // superseded — the newer call already owns what happens next
    const timedOut = err instanceof Error && err.name === 'AbortError';
    voiceLog({
      provider: 'elevenlabs',
      fallback: 'web-speech',
      retried: afterRetry,
      reason: timedOut ? `timeout (${ELEVENLABS_TIMEOUT_MS}ms)` : err instanceof Error ? err.message : String(err),
    });
    _speakWebSpeech(text, opts);
  }

  attempt()
    .then((blob) => {
      _cacheSet(text, blob);
      voiceLog({ provider: 'elevenlabs', cache: 'miss', chars: text.length });
      playBlob(blob);
    })
    .catch((err: Error & { retryable?: boolean }) => {
      if (myGeneration !== _speechGeneration) return; // superseded — do not retry a call nobody wants anymore
      if (!err.retryable) {
        fallback(err, false);
        return;
      }
      // One retry for a transient blip — a single dropped packet or a cold
      // Vercel function must not be indistinguishable from "ElevenLabs is
      // broken" and silently downgrade the whole utterance to the
      // mechanical voice. A second failure falls back for real.
      voiceLog({ provider: 'elevenlabs', retry: 1, reason: err.message });
      attempt()
        .then((blob) => {
          if (myGeneration !== _speechGeneration) return;
          _cacheSet(text, blob);
          voiceLog({ provider: 'elevenlabs', cache: 'miss', chars: text.length, afterRetry: true });
          playBlob(blob);
        })
        .catch((err2) => fallback(err2, true));
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

  const prompt = withTerminalPunctuation(text);

  // ElevenLabs is the default for every call — NOT gated on a separate
  // "did someone remember to opt in" flag. The only way to skip it is the
  // explicit escape hatch below. _speakElevenLabs() itself handles "not
  // configured"/network/timeout failures by falling back to Web Speech, so
  // attempting it here costs nothing when it isn't available (a missing
  // ELEVENLABS_API_KEY returns a fast 503 from /api/speech/model, not a
  // hang) and is strictly better when it is.
  if (VOICE_PROVIDER === 'web-speech') {
    voiceLog({ provider: 'web-speech', chars: prompt.length, reason: 'forced via NEXT_PUBLIC_VOICE_PROVIDER=web-speech' });
    _speakWebSpeech(prompt, opts);
  } else {
    _speakElevenLabs(prompt, opts);
  }
}

export function stopSpeaking(): void {
  // Supersede any in-flight ElevenLabs request/cache-callback — see
  // _speechGeneration's doc comment. Without this, a fetch already in
  // flight when stopSpeaking() is called (e.g. the child taps Close right
  // after a correction line starts) can still resolve afterward and start
  // playing audio the app just tried to silence.
  _speechGeneration += 1;
  if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
  if (_elevenLabsEl) {
    _elevenLabsEl.pause();
    _elevenLabsEl = null;
  }
  if (_elevenLabsAbort) {
    _elevenLabsAbort.abort();
    _elevenLabsAbort = null;
  }
}

/** Chapter-aware welcome line for Screen 3 (falls back to a generic line if
 *  no chapter is available yet). `alreadyRead` covers the "came back later
 *  today" case — no chapter prompt, since there isn't a new one to start.
 *  `locked` covers the paywall: there IS a new chapter, but a grown-up has
 *  to open it — said to the child without any sense of having done something
 *  wrong, and without asking them to go and pester anyone. */
export function welcomeLine(
  childName: string,
  chapter?: Chapter | null,
  alreadyRead = false,
  locked = false,
): string {
  if (locked) return `The next chapter is waiting, ${childName}! A grown-up can open it for you.`;
  if (alreadyRead) return `You already read today's chapter, ${childName}! Come back tomorrow for a new one.`;
  if (chapter) return `Ready to see what happens to ${chapter.character} today, ${childName}?`;
  return `Hi ${childName}, your new chapter is ready.`;
}

/* ── Ambience / music / UI sound (asset-based; silent if asset missing) ─ */

const AUDIO_VOLUMES = {
  theme: 0.025,
  ambience: 0.02,
  music: 0.1,
  ui: 0.28,
  duckFactor: 0.04,
} as const;
export type MusicPolicy = 'off' | 'low' | 'normal';
let musicPolicy: MusicPolicy = 'normal';

function policyFactor(): number {
  return musicPolicy === 'off' ? 0 : musicPolicy === 'low' ? 0.5 : 1;
}

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
  const steps = 16;
  let step = 0;
  const timer = setInterval(() => {
    step += 1;
    el.volume = start + ((target - start) * step) / steps;
    if (step >= steps) {
      clearInterval(timer);
      fadeTimers.delete(el);
    }
  }, 50);
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
  themeEl.volume = AUDIO_VOLUMES.theme * policyFactor() * (ducked ? AUDIO_VOLUMES.duckFactor : 1);
  void themeEl.play().then(() => audioLog(`theme -> ${themeAsset?.replace('/audio/', '').replace('.mp3', '')}`)).catch(() => {});
}

export function stopTheme(): void {
  const timer = themeEl ? fadeTimers.get(themeEl) : undefined;
  if (timer) clearInterval(timer);
  if (themeEl) fadeTimers.delete(themeEl);
  clearTrack(themeEl);
  themeEl = null;
  themeAsset = null;
  // `ducked` is a module-level singleton, not scoped to whatever page called
  // duckAmbience() — /read's phase/speaking effect has no unmount cleanup,
  // so if the child navigates away (or the tab is torn down) while phase is
  // 'listening'/'scoring'/'correction', `ducked` was left true with nothing
  // left to un-duck it. The NEXT page's playTheme() call (Home, or a fresh
  // /read mount before its own 'ready'-phase effect has had a chance to
  // fire) would then read that stale flag and start playing at the quiet
  // duck volume for no reason a fresh screen could ever justify. A full stop
  // is the correct reset point: everything `ducked` applied to is gone, so
  // there is nothing left to be "ducked relative to". Guarded on
  // `!ambienceEl` so stopping theme alone never un-ducks a still-playing
  // ambience track out from under an active correction.
  if (!ambienceEl) ducked = false;
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
    el.volume = AUDIO_VOLUMES.ambience * policyFactor() * (ducked ? AUDIO_VOLUMES.duckFactor : 1);
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
  // Only reset the shared `ducked` flag if theme isn't still relying on it —
  // see stopTheme()'s comment for why a full stop is the correct reset
  // point. Guarded on `!themeEl` so stopping ambience alone (theme still
  // playing) never un-ducks theme out from under an active correction.
  if (!themeEl) ducked = false;
}

export function setAmbienceVolume(volume: number): void {
  const next = Math.max(0, Math.min(0.12, volume));
  if (ambienceEl) ambienceEl.volume = ducked ? next * 0.18 : next;
}

/** Architectural preference hook for Wave 1; Settings UI follows later. */
export function setMusicPolicy(policy: MusicPolicy): void {
  musicPolicy = policy;
  const factor = policyFactor() * (ducked ? AUDIO_VOLUMES.duckFactor : 1);
  fadeElement(themeEl, AUDIO_VOLUMES.theme * factor);
  fadeElement(ambienceEl, AUDIO_VOLUMES.ambience * factor);
  fadeElement(musicEl, AUDIO_VOLUMES.music * factor);
}

/** Speech always wins: duck ambience while the child/AI/help audio plays. */
export function duckAmbience(): void {
  ducked = true;
  fadeElement(themeEl, AUDIO_VOLUMES.theme * policyFactor() * AUDIO_VOLUMES.duckFactor);
  fadeElement(ambienceEl, AUDIO_VOLUMES.ambience * policyFactor() * AUDIO_VOLUMES.duckFactor);
  fadeElement(musicEl, AUDIO_VOLUMES.music * policyFactor() * AUDIO_VOLUMES.duckFactor);
  audioLog('duck -> listening');
}

export function restoreAmbience(): void {
  ducked = false;
  fadeElement(themeEl, AUDIO_VOLUMES.theme * policyFactor());
  fadeElement(ambienceEl, AUDIO_VOLUMES.ambience * policyFactor());
  fadeElement(musicEl, AUDIO_VOLUMES.music * policyFactor());
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
    el.volume = AUDIO_VOLUMES.music * policyFactor() * (ducked ? AUDIO_VOLUMES.duckFactor : 1);
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

  /* Same reasoning as __audioDebug above, but for the speech/TTS side: which
   * provider actually served the last N utterances, cache hit/miss, and the
   * exact fallback reason when ElevenLabs didn't serve the call (network
   * error, non-2xx from /api/speech/model, or a timeout — see
   * ELEVENLABS_TIMEOUT_MS). Never includes the synthesized text itself or
   * any credential — only character counts and provider/error metadata, the
   * same fields voiceLog() already sends to console.debug. Answers "did
   * that correction line actually use ElevenLabs, and if not, why" from a
   * real browser/Playwright session without needing DevTools' Verbose log
   * level switched on. */
  (window as unknown as { __voiceDebug: () => Record<string, unknown> }).__voiceDebug = () => ({
    // ElevenLabs is the default now (see speakPrompt()) — VOICE_PROVIDER
    // unset/anything-but-'web-speech' means every call ATTEMPTS ElevenLabs,
    // not that web-speech is configured. Report the actual effective
    // default, not the raw (usually-unset) env var.
    effectiveDefaultProvider: VOICE_PROVIDER === 'web-speech' ? 'web-speech' : 'elevenlabs',
    rawEnvVar: VOICE_PROVIDER ?? null,
    cacheSize: _elevenLabsCache.size,
    elevenLabsPlaying: _elevenLabsEl != null && !_elevenLabsEl.paused,
    elevenLabsRequestInFlight: _elevenLabsAbort != null,
    generation: _speechGeneration,
    recent: [..._voiceHistory],
  });
}
