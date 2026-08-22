# Speech Callsite Inventory (2026-08-21)

Full trace of every place in the application that can produce spoken output,
done BEFORE changing any code, per the task that also fixed the
default-provider bug documented in `docs/VOICE_AND_PACING_AUDIT.md`.

## Finding: no callsite bypasses `speakPrompt()`

Grepped the whole app for `speechSynthesis`, `SpeechSynthesisUtterance`, and
`speakPrompt(` outside `lib/audio.ts` itself. Result: **every actual spoken
utterance in the app already goes through `speakPrompt()`** — there is no
direct `window.speechSynthesis` call, and no second speech helper, anywhere
in `app/`, `components/`, or `lib/` outside `lib/audio.ts`'s own internal
`_speakWebSpeech()` (the intentional fallback implementation) and
`stopSpeaking()` (which cancels it). This was verified, not assumed — see
the grep commands below.

**This means the "ElevenLabs only in some interactions" symptom was never a
wiring/bypass problem.** The actual root cause — a separate, easy-to-forget
client-side opt-in flag (`NEXT_PUBLIC_VOICE_PROVIDER=elevenlabs`) that had
to be kept in sync with the server-only `ELEVENLABS_API_KEY` — is fixed in
`lib/audio.ts` and documented in `docs/VOICE_AND_PACING_AUDIT.md`. Since
`speakPrompt()` is the single funnel, fixing the provider decision there
fixes it for every callsite below at once — no per-callsite changes were
needed or made.

```bash
grep -rn "speechSynthesis\|SpeechSynthesisUtterance\|speakPrompt(" app/ components/ lib/ --include=*.ts --include=*.tsx
```

## Callsites that DO speak (all via `speakPrompt()`)

| # | Category | File:line | Trigger | Text spoken |
|---|---|---|---|---|
| 1 | Home welcome / ready prompt | `app/home/page.tsx:139` | Child taps the "There's a new chapter ready for you!" pill (`replayWelcome()`) | `welcomeLine()` — combines the welcome greeting AND the "ready to see what happens" prompt in one line; there is no separate "ready prompt" utterance |
| 2 | Replay/listen + modeled story sentence | `app/read/page.tsx:570` | Child taps the header speaker icon (`replayCurrentSentence()`) | The current page's full sentence(s) (`page.text`), or the active tricky word if mid-correction — this is the ONLY way the story sentence is ever modeled; nothing speaks it automatically on page load |
| 3 | Correction / assisted continuation (rung 3) | `app/read/page.tsx:838` | Help ladder escalates a stumbled word to its final rung (`enterOrEscalateLadder`) | `rungLine(3, ...)` — a template line modeling the word within the whole sentence |
| 4 | Assisted continuation (catastrophic/phrase-exhausted) | `app/read/page.tsx:896` | `handlePhraseFailure()`'s retries-exhausted branch | Same rung-3 template, whole-sentence form (no single word — the take was globally unreliable) |
| 5 | Phrase retry | `app/read/page.tsx:909` | `handlePhraseFailure()`'s retry branch (whole take judged unreliable, retries remain) | `phraseRetryLine(page.text)` |
| 6 | Slider/correction word | `app/read/page.tsx:1453` (via `components/SlideWordHelp.tsx`'s `onComplete`) | Child finishes dragging the slide-through-the-word interaction | The tricky word itself, blended after being sounded out |
| 7 | Whole-word fallback | `components/AudioWordHelp.tsx:55` | Word can't be segmented for the slider (irregular/not-yet-taught grapheme) — mounts automatically when this help state is entered | The tricky word, spoken plainly (never phoneme-by-phoneme) |

Every row calls `speakPrompt(text, { onEnd })` with the SAME public
signature; none constructs its own `SpeechSynthesisUtterance` or fetches
`/api/speech/model` directly.

## Categories with NO spoken counterpart today

Traced and confirmed absent, not just unobserved — these are genuinely
silent (visual and/or a short non-speech SFX only) in the current app:

| Category | What actually happens |
|---|---|
| Chapter start | Silent — tapping Play on Home crosses into `/read` with a `play.mp3` UI sound and the theme track continuing; no speech fires on `/read`'s mount |
| Encouragement / success praise | `pickEncouragement()`'s string and the `praiseFor()` string are rendered as **text only** (`<div className="lc-celebrate-praise">{praise}</div>` in `app/read/page.tsx`) plus a `section-success.mp3` chime — never passed to `speakPrompt()` |
| Page transitions | Silent — `advance()` plays `page-turn.mp3` (SFX), no speech |
| Chapter completion / cliffhanger | The cliffhanger text renders visually with a `cliffhanger.mp3` music cue (`playCliffhanger()`); never spoken |

**Not fixed in this task** — adding new spoken moments is a product/UX
surface decision (what should be voiced, and how it interacts with the
"never a failure state" praise design in `CLAUDE.md`), not a routing bug.
Flagged here rather than silently added, so the acceptance test below tests
what actually exists instead of a fabricated pass on invented speech.

## Diagnosability

Every row above (and both silent-fallback paths) is traceable via:

- `console.debug('[Voice]', ...)` — `voiceLog()` in `lib/audio.ts`, printed
  on every `speakPrompt()` call (works on Vercel previews, which always run
  `NODE_ENV=production`, unlike a `NODE_ENV === 'development'` gate).
- `window.__voiceDebug()` (dev-only) — the same events as a queryable
  bounded history (last 20), plus `effectiveDefaultProvider`/`rawEnvVar`, cache size, whether
  a request is currently in flight, and the current generation counter.
  Never includes the synthesized text itself or any credential — only
  provider, cache hit/miss, character counts, and the fallback reason
  string (e.g. `"timeout (8000ms)"`, `"model route 503"`, or `"forced via
  NEXT_PUBLIC_VOICE_PROVIDER=web-speech"`).

## Verified: no unintentional fallback

`_speakWebSpeech()`'s only callers are (a) `speakPrompt()`'s explicit
`NEXT_PUBLIC_VOICE_PROVIDER=web-speech` branch and (b) `_speakElevenLabs()`'s
`fallback()` helper, reached only after ElevenLabs itself throws (including
a retry for transient failures — see `lib/audio.ts`). There is no third path
into Web Speech anywhere in the codebase.
