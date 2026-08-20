# Closing the adaptive chapter loop

Follow-up to `docs/PERSISTENCE.md`. That task proved persistence +
progression are trustworthy in isolation. This task connects them to
generation: what a child does today changes what they're given next.

## Phase 0 — audit (traced before any code changed)

1. **Where `ChildProgress` is stored.** `parents/{uid}/children/{childId}/progress/current`
   (server, Admin SDK only) and `little-chapters-progress:<uid>:<childId>`
   (localStorage, always-working primary store) — both from the previous
   task, untouched here.
2. **Where `ChildProgress.stage` is initialized.**
   `lib/child-progress.ts`'s `defaultProgressFor(childId, ageDerivedEstimate)`,
   which calls `reading-tutor/src/progression.ts`'s `initialStage()` — one
   stage below the estimate, by design (its own doc comment: parents
   overestimate, and starting too hard costs more than starting too easy).
3. **Where `applySession()` updates it.** `lib/child-progress.ts`'s
   `completeSessionPure()`, called from `completeSessionLocally()` (sync,
   local ledger) and `lib/progress-store-admin.ts`'s
   `completeSessionRemotely()` (Firestore transaction) — both from the
   previous task, untouched here.
4. **What reading evidence survives into `ChildProgress`.**
   `next.trickyWords = [...new Set([...reading.trickyWords])]` inside
   `applySession()` — the *current* session's tricky words entirely replace
   the field each time (not accumulated), sourced from
   `SessionReading.trickyWords`, which is itself built only from `counted`
   (non-excluded) words — assisted/reread/Class-A-intervened words
   structurally cannot appear here (see `docs/HELP_BOUNDARY_VALIDATION.md`,
   `docs/PERSISTENCE.md`). Nothing else about a session (accuracy, per-word
   confidence) survives onto `ChildProgress` — by construction, not by
   convention (`toPersistable()` strips it before anything is written).
5. **Every call site of `generateChapter()`.** Exactly one in production:
   `app/api/chapters/story/route.ts`. (Two more in
   `reading-tutor/test/run.ts`, pre-existing test fixtures.)
6. **How each call site determines stage.** The route trusts a
   client-supplied `body.stage` (clamped 1-10) — unchanged by this task.
   The client value it receives came from `lib/chapters.ts`'s
   `tutorStoryContext()`, which — before this task — called
   `stageForAge(profile.age)` **fresh, every single call**, completely
   ignoring any `ChildProgress` that might already exist. This is the bug
   this task closes.
7. **What personalization inputs generation currently receives.**
   `GenerateRequest` already had `interests`, `storySoFar`, and
   `recentlyMissedWords` as documented, supported fields — but
   `/api/chapters/story/route.ts` hard-coded `storySoFar: ''` and
   `recentlyMissedWords: []` on every call, regardless of what the child
   actually struggled with or what happened yesterday. An already-designed
   seam, simply never connected.
8. **Where the resulting chapter is stored/read.** `localStorage` under
   `little-chapters-tutor-chapter:<chapterId>:s<stage>` (`lib/chapters.ts`'s
   `TUTOR_CACHE_PREFIX`), read by both `/home` and `/read` on mount via
   `requestTutorChapter()`.
9. **When generation happens.** **On next visit, lazily** — `/home`'s and
   `/read`'s own mount effects both call `requestTutorChapter()`; there is
   no trigger at chapter completion, no scheduled job, and no other path.
   Two call sites, one shared cache-key/`inFlight`-map dedup mechanism, so
   they never race each other into competing generations for the same id.

**Existing validators/contracts inspected**: `validatePhonics`/
`validateContent`/`validateAll` (`reading-tutor/src/validators.ts`) — a
strict, zero-tolerance backstop already independent of any personalization
input; `buildPrompt()` (`reading-tutor/src/generate.ts`) already
re-filters `recentlyMissedWords` through `allowedWordsForStage(stage)`
before ever using them, so a word that's since become stage-inappropriate
can never reach the model regardless of what's fed in.

## Comparing implementation options

**A — generate the next chapter immediately after session persistence.**
**B — persist first, generate lazily when next actually needed** (the
architecture already in place, per point 9 above).

| | A (eager) | B (lazy, existing) |
|---|---|---|
| Correctness | Fine once Phase 1 lands | Fine once Phase 1 lands — no difference here |
| Idempotency | `chapterId` is per-CALENDAR-DAY (`chapterIdFor()`); "generate the next chapter" immediately after completion has no natural "tomorrow's id" to target without inventing forward-dated ids — a chunk of new, untested machinery | Tomorrow's visit computes tomorrow's real `chapterId` automatically; the existing cache/`inFlight` dedup (unmodified) already handles it |
| Failure recovery | Couples a generation failure to the moment right after persistence succeeded — exactly what Phase 4 warns against conflating | Todays's session already fully persisted, completely decoupled in code from generation; a failure next visit just retries via the existing fallback (`requestTutorChapter` → `null` → `chapterFor()` demo arc, already implemented) |
| Latency for the child | Adds LLM latency to the chapter-end transition the child is waiting on | Zero perceived latency — `chapterFor()` renders instantly, `requestTutorChapter()` upgrades in the background, exactly as today |
| Unnecessary LLM cost | Pays for a chapter even if the child never opens the app again | Pays only when a child actually returns |
| Concurrency / competing chapters | Needs new dedup for a chapterId that doesn't exist yet | Already solved (cache + `inFlight` map, keyed by the corrected stage-aware id) |
| Consistency with existing architecture | New architecture | **This is already the intended pattern** — nothing to invent |

**Chosen: B.** The repo already implements the "stronger intended pattern"
the task's own instructions anticipated finding. The actual gap was never
the trigger — it was that the trigger fed on stale, age-only stage and
threw away two already-designed personalization fields. Closing the loop
meant fixing what feeds the existing lazy trigger, not building a new
eager one.

## Phase 1 — persisted progression is authoritative

New `lib/chapters.ts` function, `resolveGenerationStage(profile, uid)`:
local-only, synchronous lookup of `ChildProgress` via
`lib/child-progress.ts`'s (unmodified) `loadLocalProgress()`. If a record
exists, its `.stage` wins, full stop. If not (first-ever chapter for this
child), falls back to `initialStage(stageForAge(profile.age))` — the
**same** composition `defaultProgressFor()` already uses to seed the
progress record itself, so chapter #1 and the child's starting progress
agree from the very first read (previously chapter #1 used raw
`stageForAge()`, one stage ABOVE where the progress record said the child
actually starts — a real, if minor, pre-existing inconsistency this task
also closes).

`tutorStoryContext()`, `requestTutorChapter()`, and `adaptTutorDraft()`
(the last, only for its phonics-hint label) all now route through this
single function or receive its result — no parallel stage field, no
change to `stageForAge()`/`initialStage()`/any progression threshold.

Synchronous and local-only deliberately: progress only ever changes at
chapter *completion*, never mid-read, so there's no meaningful staleness
window for a same-day generation request to hit, and it avoids adding a
network round-trip to a code path that used to be instant.

## Phase 2 — real learning state into generation

Two already-existing, previously-unused `GenerateRequest` fields, wired via
a new `resolveGenerationContext()`:

- `recentlyMissedWords` ← `ChildProgress.trickyWords` directly. No new
  derivation — inherits every invariant `applySession()`/
  `interpretSessionWithIntervention()` already guarantee (skip/reread never
  create a false tricky signal, a live intervention never becomes a clean
  win, raw measurements are never fabricated) for free, because this reads
  the *already-computed* field rather than re-deriving anything from raw
  session data.
- `storySoFar` ← the previous day's `SessionReport.teaser`
  (`lib/profile.ts`'s existing `loadReport()`). `draft.summaryLine`'s own
  doc comment in `reading-tutor/src/generate.ts` already says "for
  tomorrow's context" — it was already being computed and already being
  persisted (`Chapter.teaser` → `SessionReport.teaser`), just never read
  back into the next generation call. Wiring it in closes an
  already-designed gap.

**Deliberately not wired**: `GenerateRequest.recentNouns` (noun-repetition
avoidance across chapters) — this is a real, supported field, but has no
existing source of truth for "which nouns recent chapters used"; building
one would be new state-tracking, not integration, and the task is explicit
about not dumping in speculative state. Left as the pre-existing, still-
unused, still-available seam it already was.

## Phase 3 — hard constraints, unchanged

`validateAll()`/`validatePhonics()`/`validateContent()` are untouched.
`buildPrompt()`'s own existing filter
(`recentlyMissedWords.filter(w => allowedWordsForStage(stage).has(w))`)
already guarantees a stage-inappropriate reinforcement word can never reach
the model, regardless of what `resolveGenerationContext()` supplies — this
was true before this task and needed no new code. The retry loop
(`generateChapter()`'s `MAX_ATTEMPTS=4`, REPAIR-not-restart prompting,
banned-word accumulation) is unmodified. On exhaustion, the existing
`ok:false` → route `503` → client `null` → `chapterFor()` demo-arc fallback
is unmodified and is the only fallback mechanism this task relies on.

## Phase 4 — safety, already structurally guaranteed

Every "must not" in this phase was already true once Phase 1/2 landed,
because of the chosen architecture (Option B) plus the previous task's
persistence work:

- **Apply a session / advance progression twice** — solved by
  `completeSessionPure()`'s chapterId-keyed idempotency (previous task,
  unmodified). Generation doesn't touch this code path at all.
- **Generate multiple competing chapters** — solved by the existing
  `loadCachedTutorChapter()` + `inFlight` map, keyed by an id that now
  correctly incorporates the persisted stage. Proven in the new test:
  two consecutive `resolveGenerationContext()` reads (simulating a
  refresh) resolve identically, so they compute the identical cache id.
- **Lose the completed session if generation fails** — structurally
  impossible in this architecture: `finishChapter()` never calls
  `requestTutorChapter()`. Persistence and generation are different code
  paths on different days, never coupled. Today's session is fully
  persisted (local ledger + best-effort remote mirror) regardless of
  whether tomorrow's generation ever runs, let alone succeeds.

No new idempotency code was needed for this phase — the honest finding is
that Option B's existing shape already provides it once Phase 1 fixed what
feeds it.

## Files changed and why

- `lib/chapters.ts` — `resolveGenerationStage()` (new), `resolveGenerationContext()`
  (new), `tutorStoryContext()`/`requestTutorChapter()`/`generateTutorChapter()`
  updated to take `uid` and route stage through the above;
  `adaptTutorDraft()` gained an optional `stage` param (defaults to the old
  age-derived behavior for existing callers) so its phonics label always
  matches what was actually generated.
- `app/api/chapters/story/route.ts` — reads `recentlyMissedWords`/
  `storySoFar` from the request body (previously hard-coded to `[]`/`''`)
  and forwards them into `generateChapter()`.
- `app/home/page.tsx` — the tutor-chapter prefetch moved out of the
  unconditional mount effect into a new effect gated on auth settling (a
  `uid` is required to look up persisted stage), mirroring `/read`'s
  existing pattern; the instant demo-arc render is unchanged.
- `app/read/page.tsx` — both existing `requestTutorChapter()` call sites
  now pass `uid`.
- `reading-tutor/test/run.ts` — new "Adaptive loop" test sections (see
  below).

Untouched: `reading-tutor/src/{generate,validators,skeletons,slots,progression}.ts`,
`lib/child-progress.ts`, `lib/progress-store-admin.ts`, `lib/reading-*`,
the help ladder, all UI beyond the two effect-signature changes above,
Firestore rules, auth.

## Tests

`reading-tutor/test/run.ts`, three new sections, run via `cd reading-tutor
&& npm run test`:

- **"Adaptive loop - persisted stage wins over age"** — the task's own
  worked example, isolated: age implies stage 3, persisted progress says
  stage 2, generation uses 2.
- **"Adaptive loop - Phase 5: one complete lifecycle"** — the full 12-point
  proof, chained through real production functions: `resolveGenerationStage`
  seeds a new child (`initialStage(stageForAge(age))`, not raw age) →
  `generateChapter()`/`adaptTutorDraft()` (both unmodified) produce a real,
  validator-passing chapter #1 → a real `SessionInput` with a genuine
  stumble completes via `completeSessionLocally()` (previous task,
  unmodified) → `ChildProgress.stage` moves and `trickyWords` records the
  stumble → `resolveGenerationContext()` for chapter #2 is asserted equal
  to the persisted stage (the explicit assertion this task's Phase 5
  requires) and carries the tricky word → chapter #2 generates, validates,
  and adapts at the NEW stage → repeating the completion does not
  re-apply progression or shift the resolved generation context.
- **"Adaptive loop - API route forwards personalization inputs"** — a
  static source check (no `OPENAI_API_KEY`/network in this sandbox, same
  constraint as every other Firebase/LLM-touching task in this repo's
  history — the live route 503s before reaching this code) proving the
  wiring exists in source, mirroring the previous task's identical
  static-check pattern for the same reason.

**Regression**: all 233 tests pass (was 206 before this task — 27 new),
including the previously-settled Class A/B/C boundary tests
(`docs/HELP_BOUNDARY_VALIDATION.md`), unchanged. Root `npm run typecheck`
and `npm run build` both clean.

**Live browser smoke test** (real dev server, Playwright, no
`OPENAI_API_KEY` in this sandbox — generation calls correctly 503 and fall
back to the demo arc, unchanged existing behavior): walked a fresh child
through `/home` → `/read` → a full clean chapter completion → back to
`/home`. Zero `pageerror` crashes from the restructured `/home` effect.
`localStorage` after the run: `stage: 4` (seeded `initialStage(stageForAge(7))=2`,
then a clean session's placement big-jump `+2` — the exact `applySession()`
math, exercised for real through the actual UI, not just the test suite).
