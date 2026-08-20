# Integration spine — connecting the speech layer to the rules layer

Two systems exist in this repo and neither calls the other:

- **Speech/measurement** (`lib/pronunciation.ts`, `lib/reading-verdict.ts`,
  `lib/live-progress.ts`, `mdd/`, `/api/reading/decode`, `/api/speech/token`)
  — measures what the child said against Azure + a self-hosted MDD phoneme
  decoder, and today drives the live `/read` page's own correction UI
  directly via `combineVerdicts()`.
- **Rules/tutoring** (`reading-tutor/src/{types,interpret,progression,
  generate,validators,skeletons,slots}.ts`, `reading-tutor/content/`) —
  judges a session, decides progression, and generates the next chapter.
  Fully built, fully tested (`reading-tutor/test/run.ts`), never called with
  real data outside its own synthetic fixtures.

This document covers the adapter that bridges them (Phases 1-3 of the
integration-spine task). It does **not** wire persistence, progression
application, generation scheduling, or the live help ladder — those are
later, separate tasks, by design.

## Live path today

```
lib/profile.ts (ChildProfile)
  → lib/chapters.ts chapterFor()/requestTutorChapter() → Chapter
  → app/read/page.tsx: one beginListening(pageText) call PER PAGE (1-2 sentences)
  → lib/pronunciation.ts startReadingSession() → Azure SDK (websocket,
      token via /api/speech/token) → ReadingAssessmentResult
      { scores, words: WordScore[] (LCS-aligned; Omissions/Insertions
        synthesized client-side — see alignWords() — because Azure's
        continuous mode never returns miscue labels), transcript, audioWav }
  → audioWav → POST /api/reading/decode → mdd/ → DecodeResult
  → lib/reading-verdict.ts combineVerdicts(azureWords, decode) → WordVerdict[]
      (needsHelp only when BOTH graders object — VERDICT_THRESHOLDS)
  → app/read/page.tsx handleVerdicts(): first needsHelp word → correction UI,
      else → celebrate/advance
  → finishChapter() → saveReport() (lib/profile.ts SessionReport — parent-
      facing words/teaser, no score) → /api/messages (SMS)
```

`WordVerdict[]` is consumed **only** by the component that produced it, to
decide correction-vs-celebrate for that one page. Nothing captures a running
session across a whole chapter; there is no `ChildProgress`, no stage, no
`applySession()` call anywhere in `main`.

## Rules layer's intended pipeline

```
WordSignal[] (per expected word)
  → grouped into SentenceResult { index, text, words, assisted, reread }
  → grouped into SessionInput { childId, sessionId, stage, chapterId,
      isBookshelfReread, sentences }
  → interpret.ts interpretSession() → SessionReading
      { words: WordOutcome[], accuracy (NEVER PERSIST), countedWords,
        assistedShare, excludedFromProgression, trickyWords, cleanWords }
  → progression.ts applySession(ChildProgress, SessionReading)
      → { progress, decision }                              [NOT wired here]
  → generate.ts generateChapter(GenerateRequest{stage, recentlyMissedWords,
      skeleton, ...}) → validators.ts validateAll() → StoryDraft
  → lib/chapters.ts adaptTutorDraft() → Chapter    [ALREADY wired and tested]
```

`stage` currently comes from `stageForAge(profile.age)` in
`tutorStoryContext()` — age-derived, not reading-derived. Progression cannot
move anything yet because nothing produces a `ChildProgress` for it to read.

## The adapter — `lib/reading-signal-adapter.ts`

`toWordSignals(words: WordScore[], decode?: DecodeResult | null): AdaptedSentence`

Translation only. Every threshold and every definition of "correct" stays in
`interpret.ts`; this file reshapes data and decides nothing pedagogical.

| `WordSignal` field | Source | Reasoning |
|---|---|---|
| `word` | `WordScore.word` | Direct passthrough. |
| `heard` | `errorType !== 'Omission'` | An Omission is the LCS aligner's synthetic marker for "this reference word never appeared in recognized speech" — exactly "nothing detected in this slot." Everything else (`None`, `Mispronunciation`, `Unassessed`, etc.) means Azure recognized *something* there. |
| `duration_ms` | `WordScore.durationMs`, `0` if not heard | Direct passthrough (already ms, via `lib/pronunciation.ts`'s `Offset/Duration ÷ 10_000`). Omissions carry no real timing. |
| `gap_before_ms` | Running clock: `max(0, offsetMs - (previous word's offsetMs + durationMs))`; first word's gap = its own `offsetMs` (time from listening-start) | Derived directly from real Azure timestamps — no invention. Omissions get `0` (see below). |
| `confidence` | `WordScore.accuracy / 100`, clamped `[0,1]`; `0` if not heard or `accuracy == null` | See the comparison below — this is the field the task asked to resolve explicitly. |

**Where `confidence` comes from, and why (the two options compared):**

`WordSignal.confidence` must be, per its own docstring, *"a 0-1 linear score
from forced alignment against the expected word, NOT open-vocabulary
transcription confidence."* Three real candidates exist in the current
measurement layer:

1. **Azure per-word `AccuracyScore`** — scores the word Azure was told to
   expect (the reference text is given to `PronunciationAssessmentConfig`
   up front). Forced-alignment-based by construction. Documented in
   `CLAUDE.md`/`docs/DECODING_GRADER.md` as *lenient*: in calibration it
   "passed every clearly-misread word at 70-91."
2. **Azure per-phoneme minimum** (what `lib/reading-verdict.ts` calls
   `azureMinPhoneme`) — also forced-alignment-based, but far stricter: one
   weak phoneme in an otherwise fine word drags the whole word down. This is
   *why* `combineVerdicts()` uses it (`azureMinPhonemeBelow: 50`) — it's the
   grader designed to catch things word-level scoring misses.
3. **MDD decode score** — a lexicon-free CTC decode of whatever was said,
   *then* compared to the expected pronunciation by edit distance. This is
   structurally closer to "decode first, compare after" than "aligned
   against the expected word from the start" — arguably the "open-vocabulary
   transcription confidence" the type's docstring explicitly rules out. Also
   documented as the most trigger-happy signal alone: "raw MDD flagged 38%
   of expert-perfect words" in calibration.

**Chosen: option 1, Azure per-word `AccuracyScore`.** It wins on both the
type's own literal contract (word-level forced alignment) and the stated
tiebreaker (minimize false-flagging a correct read) — it's the one signal
of the three that is documented to essentially never fail a word the child
actually read correctly. Options 2 and 3 are both *deliberately* more
aggressive than option 1 (that's their whole purpose in the existing verdict
system, which only trusts them when they agree with each other), and
plugging either into `confidence` alone would push `interpret.ts`'s already
generous `confidenceFloor: 0.35` toward false 'stumbled' verdicts.

**Insertions:** not representable in `WordSignal` at all — the type is
indexed by *expected* word, and an insertion is recognized speech that
didn't align to any reference word. The adapter drops them from `signals`
(by construction: `WordSignal[]` must stay in reference-word order) and
surfaces them separately as `AdaptedSentence.insertions: string[]`, so they
are dropped deliberately, not silently.

**Deletions / silence:** an `Omission` → `heard: false`, `confidence: 0`,
`duration_ms: 0`, `gap_before_ms: 0`. The `0`s are a documented "we don't
know" value, not fabricated timing evidence — `interpret.ts`'s `judge()`
returns `'missed'` from `!heard` before it ever inspects `gap_before_ms` or
`duration_ms`, so this is inert by construction, not a hidden assumption.

**Phoneme-level and MDD evidence:** preserved, but *only* as
`AdaptedSentence.diagnostics: WordSignalDiagnostic[]` — `azureAccuracy`,
`azureMinPhoneme`, `decodeScore`, `decodeHeard`, `errorType` per word. This
is built by calling the existing `combineVerdicts()` and reading its
per-word fields (not its `needsHelp`/`reason` — those are judgment and are
discarded). Reusing `combineVerdicts()`'s already-correct Azure/MDD
alignment here, rather than re-deriving it, is deliberate: writing a second
alignment routine would be exactly the "second interpretation system" this
adapter must not become. Diagnostics never reach `WordSignal` and are never
passed to `interpretSession()` — they exist for logging/tuning only.

`toSentenceResult(index, text, words, decode?, {assisted?, reread?})` is a
thin convenience wrapper for callers assembling a `SessionInput`.
`assisted`/`reread` describe *how the reading happened* (read to the child?
a post-help reread?) — the measurement layer has no way to know that, so
they are caller-supplied, never inferred.

## Tests

`reading-tutor/test/run.ts`, section **"Reading signal adapter"** (run via
`cd reading-tutor && npm run test`, or `node reading-tutor/test/run.ts` once
`reading-tutor/node_modules` is installed — same `tsx`-based runner as every
other rules-layer test, no new framework). Uses representative per-word data
modeled on real Azure output shapes (realistic ms offsets, 0-100 accuracy
distributions, per-phoneme detail) for the real demo sentence "Rex raced
across the field...", not synthetic round-number edge cases only. Covers:
normal word translation, the confidence-vs-phoneme-minimum distinction
(the actual tiebreaker decision, asserted directly), Omissions, Insertions
(dropped + surfaced separately), the rare `Unassessed` null-handling case,
MDD diagnostic enrichment, and the `SentenceResult` wrapper. 27 new
assertions, all passing alongside the existing 106.

## Phase 3 — one full session through `interpretSession()`

`scripts/run-one-reading-session.ts` (`node scripts/run-one-reading-session.ts`
from the repo root).

**No real recorded audio or captured Azure/MDD response exists anywhere in
this repo** — checked: no `.wav` fixtures anywhere, and
`reading-tutor/bench/manifest.json` (the calibration-clip format) is present
but empty; only `manifest.example.json` exists as a template. This run
therefore uses representative per-word measurements — realistic timings and
score distributions, not round test numbers — applied to the **real** demo
chapter text (`lib/chapters.ts`, `STORY_SKELETONS[0]`, the "dogs" interest
chapter, three real pages, 31 words total, deliberately above
`minCountableWords: 12` so the session isn't trivially excluded). It
includes a genuine mispronunciation, a long hesitation, a skipped word, and
a slowly-sounded-out word — not a synthetic all-clean pass.

Result: `trickyWords: ['across', 'and', 'hill']`, `excludedFromProgression:
false`, 31/31 words counted, one word (`raced`, Azure accuracy 38) reads as
`'correct'` rather than `'stumbled'`. **This is a genuine, worth-flagging
finding, not a bug**: `38/100 = 0.38`, which sits just above
`interpret.ts`'s generous `confidenceFloor: 0.35`. The *existing* live
verdict system (`combineVerdicts`) would very likely flag this exact word —
38 is well under both `azureMinPhonemeBelow: 50` and `mddBelow: 70` — while
the rules-layer pipeline being connected here would not. Both systems were
calibrated independently and correctly for their own purposes; this is
exactly the kind of cross-system interaction an integration pass is meant to
surface for human review, not silently resolve. No script or adapter change
was made to hide or "fix" this — the numbers are real output, unedited.

Does not call `applySession()`. Does not persist anything. Prints
`SessionReading`'s fields except `accuracy` (which the type's own doc
comment says must never be persisted or shown — this script doesn't even
log it, on principle, though it's an in-memory demo run showing nobody).
