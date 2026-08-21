# Child Media Lifecycle — Audio, Voice, and Mic State Table

Traces the full child-facing media path — `Home → story start → tutor speech
→ listening → child speaking → scoring → correction → retry → success →
page transition → chapter completion → navigation away` — across
`app/home/page.tsx`, `app/read/page.tsx`, and `lib/audio.ts`. This is the
authoritative reference for what SHOULD be playing at every phase; the two
bugs it caught (see "Bugs found and fixed" below) were both violations of
what this table says should be true.

## Audio channels

| Channel | Backing | Who owns it |
|---|---|---|
| Theme | `themeEl` (looping, per-interest) | `prepareStoryAudio`/`playTheme`/`stopTheme` |
| Ambience | `ambienceEl` (looping, per-`Chapter.ambience`) | `playAmbience`/`stopAmbience` — **defined but never called anywhere in the app**; dead code today (see below) |
| Music | `musicEl` (one-shot, e.g. cliffhanger cue) | `playMusic`/`stopMusic`/`resumeMusic` |
| UI SFX | transient `Audio()` per call | `playUISound` and its named wrappers (`playHomeSound`, `playReadingCue`, `playListeningStart`) |
| Tutor speech | ElevenLabs (`_elevenLabsEl`) or Web Speech (`speechSynthesis`) | `speakPrompt`/`stopSpeaking` |
| Mic / listening | Azure continuous recognition (`lib/pronunciation.ts`, frozen) | `beginListening`/`finishListening`/`sessionRef` in `app/read/page.tsx` |

`duckAmbience()`/`restoreAmbience()` scale **theme and ambience only** (not
music, not UI SFX) by `duckFactor = 0.35`. Ducking is driven by a single
module-level `ducked` boolean in `lib/audio.ts` — this is what made the
cross-page leak below possible: it isn't scoped to any one page or
component.

## State table

`—` = channel not applicable/not touched in that phase. "Active" for tutor
speech/mic means the channel *may* legitimately be running; the two are
mutually exclusive by design (see Hard requirements below).

| Phase | Theme | Ambience | Music | Tutor speech | Mic/listening |
|---|---|---|---|---|---|
| **Home, idle** | normal (once played) | — (unused) | — | idle | inactive |
| **Home, replay welcome** | normal | — | — | active (Web Speech or ElevenLabs) | inactive |
| **Story start** (`startChapter`) | normal → carries into `/read` | — | — | idle | inactive |
| **`/read` ready** | normal | — | — | idle (unless header replay tapped) | inactive |
| **Tutor speech** (header replay / rung 3 / phrase retry) | ducked | — | — | active | inactive (mic never opens while `speaking`) |
| **Listening** (mic open) | ducked | — | — | idle | active |
| **Scoring** | ducked | — | — | idle | inactive (session already stopped) |
| **Correction — help interaction** (SlideWordHelp / AudioWordHelp, before the blend/pronunciation plays) | ducked | — | — | idle | inactive |
| **Correction — blend/pronunciation speaking** | ducked | — | — | active | inactive |
| **Correction — retry take** ("Try the word") | ducked | — | — | idle | active |
| **Celebrate** | normal (restored) | — | — | idle | inactive |
| **Page transition** (`advance()`) | normal | — | — | idle | inactive |
| **Chapter end** | **stopped** (not ducked — the cliffhanger cue owns the moment) | — | one-shot cliffhanger, then idle | idle | inactive |
| **Backgrounded** (`document.hidden`/`pagehide`) | paused (theme/ambience/music), speech cancelled | paused | paused | stopped | mic capture continues server-side but the app stops driving new speech into a hidden tab |
| **Foregrounded** | resumes at whatever phase now implies (re-derived, not blindly restored) | — | resumes from where it paused (chapter-end only) | idle until re-triggered | unaffected |
| **Navigation away** (Close / router change) | stopped | stopped | stopped | stopped | session cancelled |

## Hard requirements — how each is enforced

- **Music must never become louder when the child starts speaking.**
  `beginListening()` calls `duckAmbience()` **synchronously**, before the
  mic session setup even starts (not just via the `[phase, speaking]`
  effect, which lags one render tick). Every other entry into a
  speech/listening phase (`replayCurrentSentence`, `enterOrEscalateLadder`,
  `handlePhraseFailure`) does the same.
- **Tutor speech and mic capture must not intentionally overlap.**
  `beginListening()` calls `stopSpeaking()` synchronously at its start. The
  correction UI's mic-retry button (`helpDone`) only enables after the
  help interaction's `onComplete` fires, which itself only fires after its
  `speakPrompt()` call's `onEnd` — sliding/listening always visibly
  precedes retrying aloud, never the reverse.
- **Scoring/correction/navigation cannot leave stale audio running.** See
  "Bug 2" below — this was violated by the ElevenLabs stale-fetch race and
  is now fixed with a generation counter + `AbortController`.
- **Returning from background must not revive obsolete audio.**
  `pauseForBackground()` pauses without clearing loaded assets; on
  `visibilitychange` back to visible, each page re-derives what SHOULD play
  from its **current phase**, never blindly resumes whatever was paused.
  Chapter-end is the one deliberate exception (`resumeMusic()` continues the
  cliffhanger cue from where it paused, since that phase owns the moment).
- **Page transitions must clean up prior speech/music state.** See "Bug 1"
  below — this was violated by the `ducked` flag leaking across navigation
  and is now fixed.

## Bugs found and fixed (2026-08-21)

### Bug 1 — stale `ducked` flag leaks across navigation

`stopTheme()`/`stopAmbience()` never reset the module-level `ducked` flag.
The `[phase, speaking]` effect in `app/read/page.tsx` that normally calls
`restoreAmbience()` has no unmount cleanup — it only runs on render. If a
child closed `/read` (or the tab was torn down) while `phase` was
`listening`/`scoring`/`correction` (i.e. `ducked === true`), that flag
stayed `true` at module scope with nothing left to un-duck it. The next
screen's `playTheme()` call — Home, or a fresh `/read` mount before its own
`ready`-phase effect had a chance to fire — read that stale flag and played
theme at the quiet duck volume for no reason the new screen could ever
justify.

**Fix**: `stopTheme()` and `stopAmbience()` now reset `ducked = false`,
guarded so stopping one track never un-ducks a still-playing sibling. A full
stop is the correct reset point — everything `ducked` applied to is gone, so
there's nothing left to be "ducked relative to."

**Regression test**: `scripts/test-audio-lifecycle.ts`, "Test 2" — enters
listening (ducks theme), closes `/read` mid-listening, asserts
`__audioDebug().ducked === false` on `/home` and that theme actually plays
un-ducked there. Confirmed this fails without the fix (timed out/read
`true`) and passes with it.

### Bug 2 — ElevenLabs stale-fetch race

`_speakElevenLabs()` cancelled a **currently playing** clip on a new call,
but never cancelled an **in-flight `fetch()`** from a previous call. Two
scenarios both produced stale audio:

1. Two `speakPrompt()` calls close together — the second starts cleanly
   (nothing is playing yet to cancel), but the first call's fetch can still
   resolve afterward, overwrite `_elevenLabsEl` without pausing the second
   call's clip, and start playing on top of it.
2. `stopSpeaking()` called while a fetch is still in flight (e.g. the child
   taps Close right after a correction line starts) — the fetch can resolve
   *after* the app tried to silence everything, and start playing audio
   `stopSpeaking()` can no longer reach (it already nulled `_elevenLabsEl`
   before the stale response arrived).

There was also no request timeout: a hung network left `speaking` state
stuck `true` forever, since nothing would ever call `onEnd()` — permanently
disabling the correction UI's "Try the word" button and the header replay
toggle.

**Fix**: a module-level `_speechGeneration` counter, bumped on every
`speakPrompt()` call and every `stopSpeaking()` call. Each
`_speakElevenLabs()` call captures its generation at the start and checks it
again immediately before `playBlob()` — a stale response is silently
dropped rather than played. Paired with a per-call `AbortController`
(aborted on supersede or explicit stop, for actual network cancellation) and
an 8s timeout that falls back to Web Speech rather than hanging indefinitely.

**Regression test**: `scripts/test-audio-lifecycle.ts`, "Test 1" — holds the
first `/api/speech/model` response open, calls `stopSpeaking()` while it's
still in flight, then releases it; asserts the stale response never starts
playback and `speechSynthesis.speaking` stays `false`. Confirmed this fails
without the fix and passes with it.

## Dev diagnostics

- `window.__audioDebug()` (existing) — `ducked`, theme/ambience/music
  element state, `speechSynthesis.speaking`, active fade-timer count.
- `window.__voiceDebug()` (new) — configured provider, ElevenLabs cache
  size, whether a clip is currently playing, whether a request is in
  flight, the current generation counter, and the last 20 voice events
  (provider, cache hit/miss, character count, fallback reason — **never**
  the synthesized text itself or any credential). Same console.debug gate
  as the existing `[Voice]` log (works on Vercel previews, where
  `NODE_ENV` is always `production`), but queryable after the fact instead
  of only visible live in DevTools' Verbose log level.

Both are dev-only (`NODE_ENV === 'development'`), dead-code-eliminated from
production bundles, same pattern as every other debug hook in `lib/audio.ts`.

## Ambience: defined, never wired

`playAmbience()`/`stopAmbience()`/`ambienceAssetFor()` exist in
`lib/audio.ts` and are exported, but no page or component ever calls
`playAmbience()` — only `duckAmbience()`/`restoreAmbience()` are used, and
those affect `ambienceEl` only if something else has already populated it.
In practice, "ambience" never plays in this app today; only "theme" does.
This is not a bug (nothing violates the hard requirements because of it —
an unplayed track can't get louder or overlap anything) but is worth
flagging: either wire `playAmbience(ambienceAssetFor(chapter.ambience))`
into `/read`'s mount effect if a second, chapter-specific ambient layer
under the theme is still wanted, or remove the dead exports. Left as-is
this pass — out of scope beyond the diagnosis (no hard requirement forced a
change here, and adding a new audio layer is a product decision, not a bug
fix).
