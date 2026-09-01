# V1 story and image generation contract

This document records the repair prompted by the live `4508c445` QA sample.
Validators remain release backstops; the generator now receives their actual
constraints before it writes child-facing prose.

| Live rule | Validator requirement | Previous generator gap | Repair owner |
|---|---|---|---|
| `goal-discontinuity` | One unresolved goal must persist until resolution. | The model copied complete state snapshots and used free-text goals. | Prompt uses `goalId`; deterministic state inheritance preserves it. |
| `unexplained-entity` | A required visible object must already be known/carried or be discovered on that beat. | “Introduce before use” was ambiguous while every state array was hand-copied. | Prompt says when to declare discovery; normalization inherits state and records first-visible discoveries. |
| `malformed-prediction` | Subject, finite action, meaningful complement, complete distinct sentence. | A tiny finite-verb list rejected valid actions, while the prompt gave no stage-legal caption pattern. | Broader inflection-aware recognition plus `Child can <legal action> <complement>.` and stage action vocabulary. Fragments remain rejected. |
| `unresolved-ending` | The original planned goal must be closed by the resolution beat. | Validator searched for the last English token of `characterGoal` in resolution prose. | `goalId`, `goalResolutionStatus`, and `goalResolutionBeatId` replace lexical substring matching. |
| `phonics/not-decodable` | Tokens must be current-stage, approved names, or legal preview words. | Model only received stage number and target words. | Prompt receives the validator's exact current and next-stage sets; illegal targets are removed before generation. |
| `phonics/too-many-preview-words` | At most two distinct next-stage words. | The model did not know the preview set or cap. | Prompt names the set and cap; targeted retry restates both. |
| `phonics/sentence-length` | Every child-facing sentence fits the stage min/max. | The range was absent from the blueprint prompt. | Exact range is supplied initially and on targeted retry. |
| `content/unknown-proper-noun` | Only approved cast names may be capitalized mid-sentence. | The prompt did not prohibit invented names/places. | It lists the only approved proper nouns and requires generic lowercase places. |

## Validation order

`validateStoryBlueprintSemantics()` is the provider-retry boundary. It checks
the goal, causal beats, state/entity continuity, reconvergence, resolution, and
that Prediction consequence beats author two distinct semantic outcomes. It
does not judge captions or child-facing pages.

`validateStoryBlueprintPresentation()` classifies repairable captions and page
text. `validateStoryBlueprint()` remains the strict final validator and combines
both layers. A semantic-valid response with presentation or literacy failures
is realized once and then run through the strict blueprint and literacy
validators; it does not consume a second provider attempt.

## Image review recovery

The reviewer confidence and verified-object threshold remain unchanged. Up to
three storyboard attempts are allowed. A rejected attempt contributes only
bounded structural feedback (failed panel criteria and sanitized reason codes)
to the next prompt. Diagnostics contain statuses, booleans, confidence, and
reason codes—not prompts, image URLs, child context, or raw provider output.

Per-panel requirements are authoritative. A global `approved: true` cannot
rescue a failing panel; a global `approved: false` cannot veto four panels that
all satisfy the complete explicit contract. Static fallback selection uses an
unused approved asset until its pool is exhausted, while still preferring the
best semantically relevant unused candidate.
