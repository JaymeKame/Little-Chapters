# Help-boundary validation — does live help agree with progression?

Follow-up to `docs/INTEGRATION_SPINE.md`. That work's Phase 3 surfaced one
word (`raced`, Azure accuracy 38) that `interpretSession()` called
`'correct'` while the live correction system would almost certainly have
flagged it. This is that discrepancy investigated properly, across a
representative range, not just the one word that happened to surface it.

The Class A boundary described below (live already intervened → that word
can never read as `correct`) is now implemented, via a new file,
`lib/reading-session-interpreter.ts` — see "How it's implemented" below.
`interpret.ts`, `DEFAULT_INTERPRET_CONFIG`, and `VERDICT_THRESHOLDS` are
still untouched; `lib/reading-signal-adapter.ts` gained one new output field
(`interventions`), described below, but `WordSignal` itself did not change.

Run: `node scripts/validate-help-boundary.ts`

## The two decisions being compared

- **Live** (`lib/reading-verdict.ts` `combineVerdicts()` → `needsHelp`) —
  what actually drives the correction UI a child sees today. Requires
  **both** graders to object: MDD word score < 70 **and** Azure min-phoneme
  < 50 (or, when MDD is down, Azure min-phoneme < 40 alone).
- **Rules layer** (adapter → `WordSignal` → `interpretSession()` →
  `correct`/`stumbled`/`missed`) — what would feed progression if it were
  wired up. Uses a single `confidence` value (Azure word-level accuracy,
  per the adapter's own documented choice) against a `0.35` floor, plus two
  independent timing checks (`gap_before_ms > 1200`, `duration_ms > 1800`).

## The matrix

15 cases, real words from the actual demo chapters (`lib/chapters.ts`
`STORY_SKELETONS[0]`/`[1]`), each given a realistic-but-constructed
Azure/MDD score profile chosen to land in a specific region of the decision
space — not sampled randomly, not limited to the one word that surfaced the
bug.

| Bucket | Word | Azure acc. | Phoneme-min | MDD | Live | Rules | Agree? |
|---|---|---|---|---|---|---|---|
| clearly correct | Rex | 92 | 90 | 90 | fine | correct | ✓ |
| clearly correct | sat | 96 | 95 | 94 | fine | correct | ✓ |
| clearly wrong | shadow | 18 | 12 | 15 | needsHelp | stumbled | ✓ |
| clearly wrong | bright | 22 | 15 | 25 | needsHelp | stumbled | ✓ |
| omission | calm | — | — | — | needsHelp | missed | ✓ |
| **live flags / rules says correct** | raced | 38 | 22 | 35 | needsHelp | **correct** | **✗** |
| **live flags / rules says correct** | still | 52 | 25 | 42 | needsHelp | **correct** | **✗** |
| **live flags / rules says correct** | began | 40 | 20 | 48 | needsHelp | **correct** | **✗** |
| **rules flags / live says fine** | kept | 30 | 58 | 75 | fine | **stumbled** | **✗** |
| **rules flags / live says fine** | loud | 33 | 55 | 58 | fine | **stumbled** | **✗** |
| **rules flags / live has no opinion (timing)** | sun | 91 | 90 | 88 | fine | **stumbled** | **✗** |
| **rules flags / live has no opinion (timing)** | small | 87 | 85 | 85 | fine | **stumbled** | **✗** |
| boundary tie, exactly at threshold | came | 35 | 50 | 70 | fine | correct | ✓ |
| boundary tie, one unit past | back | 34 | 49 | 69 | needsHelp | stumbled | ✓ |
| **MDD-down infra case** | move | 30 | 45 | (MDD down) | fine | **stumbled** | **✗** |

**7 agree, 8 disagree, out of 15.** The sanity-check buckets (clearly
correct/wrong, omission, boundary ties) all agree, as they should — every
disagreement is in a case deliberately constructed to sit in the gap
between the two systems.

## Every disagreement, and why

**Class A — live flags, rules says `correct` (`raced`, `still`, `began`).**
Word-level Azure accuracy (38–52) clears `interpretSession()`'s `0.35`
floor even though phoneme-minimum (20–25) and MDD (35–48) both fail live's
stricter bar. This is not a threshold-height problem — `interpretSession()`
only ever sees ONE number (word-level confidence); live's decision is built
from TWO independent, stricter signals. No single floor value can make a
coarser statistic track a finer one across the board.

**Class B — rules flags, live says fine (`kept`, `loud`, `move`).** The
mirror image: word-level accuracy is low (30–33) but the phoneme-minimum
and/or MDD score don't corroborate it, so live — which requires
convergence — lets it through. `move` additionally shows an **infrastructure
dependency**: with MDD down, live falls back to a looser Azure-only
threshold (`<40` instead of the combined `<50` + `<70`), so the *same*
phoneme evidence can flip live's verdict depending on whether the MDD
service happened to be up that night — a variable the rules-layer
`confidence` (word-accuracy-only, never touches MDD) doesn't see at all.

**Class C — rules flags on timing, live has no opinion (`sun`, `small`).**
Both graders are fully satisfied on accuracy; `interpretSession()` flags
these purely because of a long pause before starting (`sun`) or a long
duration while sounding the word out (`small`). Live has **no timing
dimension at all** — this isn't a threshold mismatch, it's a signal
`combineVerdicts()` structurally does not have.

## The product question: should these be equally sensitive?

**No — but only along principled lines, and Class A is not one of them.**

**Class C (timing) — intentionally different, keep as-is.** Interrupting a
child mid-reading because a *correctly-read* word took them a while would
violate the product's own "never block, never make a child feel bad about
something they got right" principle — CLAUDE.md is explicit that
corrections are for decoding failures, not slowness. But progression
benefits from knowing a word cost effort even when it was ultimately read
right; gently reinforcing it in a future chapter, without ever having
interrupted the child live, is legitimate and good. This is a dimension
live shouldn't have, not a bug that it doesn't.

**Class B (accuracy, rules flags / live doesn't) — acceptable residual
asymmetry.** The child wasn't given incorrect live feedback here; the
practical cost is a word occasionally showing up in tomorrow's reinforcement
content that live's stricter, convergence-based check would have let pass.
Mild, and arguably consistent with "require a bit more before something
counts as settled" — progression erring cautious on a genuinely marginal
word-level score is a reasonable posture.

**Class A (accuracy, live flags / rules says `correct`) — NOT acceptable,
and not a legitimate asymmetry.** This is exactly the corruption case
described in the task: a child gets corrected live on a word, and the same
word can end up in `cleanWords` — the specific "great win to tell the
parent" list — in the very same session. `SessionReading.cleanWords` exists
specifically to name a concrete win in the parent SMS; a false one there
isn't a rounding error, it's a wrong claim the app makes to a parent, in a
product whose whole pitch is "permission, not guilt" built on being honest
about what actually happened. `interpretSession()`'s three-way verdict
(`correct`/`stumbled`/`missed`) has no neutral "insufficient evidence"
bucket — a word that clears the floor is *asserted* correct, not merely
"not flagged." That's what makes Class A actively harmful where Class B is
merely imprecise.

## The boundary (confirmed, implemented)

**One invariant, not a retuned number:** *a word `interpretSession()` calls
`correct` must never be a word live's `combineVerdicts()` already called
`needsHelp` on, in the same take.*

This is deliberately **not** "raise the floor," which the task ruled out and
which wouldn't work anyway (Class A isn't a threshold-height problem — see
above). It's also not a rules-engine change: `interpret.ts` and
`DEFAULT_INTERPRET_CONFIG` stay exactly as they are, unmodified and still
the only place a `WordSignal` gets judged.

**The mechanism first proposed here — forcing a word's `confidence` to `0`
whenever `combineVerdicts()` already said `needsHelp` — was rejected**
before being implemented. It collapses two different facts (what the
measurement actually was, and what was decided about it) into one number and
throws the first one away: a debugger looking at `raced`'s `confidence: 0`
would have no way to know Azure actually scored it 0.38. The adapter
translates measurements; it does not decide outcomes. That principle, set
when the adapter was first built (`docs/INTEGRATION_SPINE.md`), still
applies here, so the mechanism had to change, not the invariant.

### Design options considered

Three ways to carry "live already intervened on this word" from the adapter
to the rules layer, without putting a judgment inside `WordSignal`:

1. **Per-word intervention evidence attached to `SentenceResult`/
   `SessionInput` by word index.** Would mean adding a field to
   `reading-tutor/src/types.ts` — exactly the class of change this whole
   task exists to avoid touching. Rejected on that basis alone, even though
   it's arguably the "natural" home for the data.
2. **A separate companion structure passed alongside `WordSignal[]`.**
   Zero changes to any file under `reading-tutor/src/`. The adapter already
   returns a companion array in this exact shape — `diagnostics:
   WordSignalDiagnostic[]`, one entry per signal, for debug/tuning data that
   never reaches `interpretSession()` — so this reuses an established
   pattern rather than inventing a new one, and it reuses the *already
   computed* `combineVerdicts()` call the diagnostics pass makes, not a new
   alignment routine.
3. **An optional field on the interpretation input itself.** Same objection
   as (1): the "interpretation input" for `interpretSession()` *is*
   `SessionInput`, defined in `reading-tutor/src/types.ts`. Adding a field
   there, optional or not, is still a `reading-tutor` change, and it still
   invites `interpret.ts`'s own `judge()` to read it directly — the
   override would then live inside the rules engine rather than as an
   explicit, separately-reviewable step in front of it.

**Chosen: option 2.** It's the only one of the three that requires editing
no file inside `reading-tutor/src/` at all — `WordSignal`, `SentenceResult`,
`SessionInput`, and `interpret.ts` are all byte-for-byte what they were
before this task. The judgment (the override) lives entirely in a new file,
`lib/reading-session-interpreter.ts`, on the measurement-layer side of the
boundary, applied as a post-processing pass over `interpretSession()`'s own
unmodified output — never inside `interpret.ts`, never inside `WordSignal`.

### How it's implemented

- **`lib/reading-signal-adapter.ts`** — `AdaptedSentence` gained one new
  field, `interventions: boolean[]`, same length/order as `signals`.
  `interventions[i]` is `combineVerdicts()`'s own `needsHelp` for
  `signals[i]`'s word — a passthrough of a decision already made elsewhere,
  not a new one. `signals[i].confidence` is completely unaffected by it: the
  confidence computation block is exactly what it was, still only ever the
  raw Azure word-accuracy translation, `needsHelp` never enters it.
  `toSentenceResult()` returns `interventions` alongside `sentence`,
  `diagnostics`, `insertions`.
- **`lib/reading-session-interpreter.ts`** (new) —
  `interpretSessionWithIntervention(session, interventions, cfg?,
  previouslyTricky?)` calls `interpretSession()` completely unmodified, then
  walks its `words: WordOutcome[]` result: any word whose verdict came back
  `'correct'` AND whose aligned `interventions[sentenceIndex][wordIndex]` is
  `true` gets overridden to `'stumbled'`. Everything else — `interpret.ts`'s
  `0.35` floor, its timing checks, its bookshelf/assisted-heavy/too-few-words
  exclusion logic — runs exactly as before and is never touched. When the
  override changes at least one word, `accuracy`/`countedWords`/
  `excludedWords`/`trickyWords`/`cleanWords` are re-derived using the
  identical filter/dedup recipe `interpret.ts` itself uses (copied, not
  reinvented) so the two never drift apart; when nothing changes, the
  function returns `interpretSession()`'s own result object as-is.
  Intervention data is aligned to `session.sentences[i].words[j]` by
  **position** (sentence index, then word index), mirroring exactly the
  iteration order `interpretSession()` uses internally — not by word text,
  since real chapter text repeats words (e.g. "looked...looked").

### Real result (`scripts/validate-help-boundary.ts`)

Same 15 cases as the as-is table above. Second pass now calls the real
`interpretSessionWithIntervention()` with the adapter's real
`interventions` output (verified to agree with a direct `combineVerdicts()`
call for every case) — no confidence value is fabricated or zeroed anywhere
in this pass:

**10 agree, 5 disagree** (was 7/8). All three Class A cases resolve. The
five that remain — `kept`, `loud`, `move` (Class B) and `sun`, `small`
(Class C) — are unchanged from the as-is pass, left disagreeing on purpose,
exactly as argued above.

`raced`, in full — the real confidence value stays visible on `WordSignal`,
the intervention fact travels separately, and the override is visible in
the rules verdict:

```
raced
Azure confidence: 0.38
live intervention: true
rules verdict: stumbled
eligible for cleanWords: false
```

## Branch / diff

Branch: `claude/help-boundary-validation`, off `claude/integration-spine`.

- `lib/reading-signal-adapter.ts` (modified) — `AdaptedSentence` gained
  `interventions: boolean[]`; `toWordSignals()`/`toSentenceResult()` compute
  and return it. `WordSignal`/`confidence` computation is unchanged.
- `lib/reading-session-interpreter.ts` (new) — the Class A override, applied
  as a post-processing pass over `interpretSession()`'s unmodified output.
- `scripts/validate-help-boundary.ts` (modified) — the matrix, the as-is
  pass, and the real (not simulated) intervention-override pass.
- `docs/HELP_BOUNDARY_VALIDATION.md` (modified, this file).

`interpret.ts`, `DEFAULT_INTERPRET_CONFIG`, `VERDICT_THRESHOLDS`,
`reading-tutor/src/types.ts`, and `WordSignal` itself: untouched. No
persistence, progression application, help ladder UI, or `/read` changes.
