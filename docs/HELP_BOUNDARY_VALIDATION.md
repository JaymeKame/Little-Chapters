# Help-boundary validation — does live help agree with progression?

Follow-up to `docs/INTEGRATION_SPINE.md`. That work's Phase 3 surfaced one
word (`raced`, Azure accuracy 38) that `interpretSession()` called
`'correct'` while the live correction system would almost certainly have
flagged it. This is that discrepancy investigated properly, across a
representative range, not just the one word that happened to surface it.

**Analysis only.** Nothing here is applied to `lib/reading-signal-adapter.ts`,
`interpret.ts`, `VERDICT_THRESHOLDS`, or `DEFAULT_INTERPRET_CONFIG`. The
proposed fix at the end is flagged for confirmation, not implemented.

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

## Proposed boundary (flagged for confirmation — not implemented)

**One invariant, not a retuned number:** *a word `interpretSession()` calls
`correct` must never be a word live's `combineVerdicts()` already called
`needsHelp` on, in the same take.*

Concretely: when the adapter (`lib/reading-signal-adapter.ts`) sees that
`combineVerdicts()` already produced `needsHelp: true` for a word — which it
already computes today, currently used only for the diagnostics side-channel
— it would force that word's `confidence` to `0` instead of computing it
from Azure word-level accuracy. Every other word's confidence is untouched.

This is deliberately **not** "raise the floor," which the task ruled out and
which wouldn't work anyway (Class A isn't a threshold-height problem — see
above). It's also not a rules-engine change: `interpret.ts` and
`DEFAULT_INTERPRET_CONFIG` stay exactly as they are; only the *input* the
adapter feeds them changes, for the specific words live already had a
strict, dual-signal reason to flag. It reuses the *existing*,
already-calibrated `VERDICT_THRESHOLDS` (`docs/DECODING_GRADER.md`'s
speechocean762 study) as the one canonical source for "this word is a
genuine problem" — rather than introducing a second, independently-tuned
number that can drift out of sync with it.

**Simulated result** (`scripts/validate-help-boundary.ts`, second pass —
confidence forced to `0` only where `liveNeedsHelp` was true, nothing else
touched): **10 agree, 5 disagree** (was 7/8). All three Class A cases
resolve. The five that remain — `kept`, `loud`, `move` (Class B) and `sun`,
`small` (Class C) — are exactly the ones argued above to be legitimate,
left disagreeing on purpose.

**This is the decision that needs Jayme's confirmation before it becomes
load-bearing**: that Class A should be closed via this mechanism, and that
Class B/C should remain open asymmetries rather than also being closed.
Nothing about this has been wired into the adapter, `/read`, or any
persistence path — this doc and the validation script are the entire diff.

## Branch / diff

Branch: `claude/help-boundary-validation`, off `claude/integration-spine`.

- `scripts/validate-help-boundary.ts` (new) — the matrix and both the
  as-is and simulated-fix passes.
- `docs/HELP_BOUNDARY_VALIDATION.md` (new, this file).

No other files touched. No persistence, progression application, help
ladder UI, or `/read` changes.
