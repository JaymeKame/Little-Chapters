# Watchtower V1: Phase 6 repeat reasoning

Phase 6 compares the newest Phase 5 `AttemptSummary` with up to six recent failed or unresolved
summaries. It does not inspect raw transcripts, source files, repository contents, or normalized events.
It does not implement alerts or modify capture, normalization, segmentation, evidence extraction, or
summarization.

## Architecture

`RepeatReasoningEngine.compare` compacts Phase 5 summaries, records adjacent same-problem attempt IDs
as possible fragmentation context, and sends the summaries to an `ReasoningProvider`. The primary
provider uses the OpenAI Responses API with strict structured JSON output. The default model is
`gpt-5-mini`; set `WATCHTOWER_REASONING_MODEL` to select a model explicitly.

The versioned `watchtower-repeat-reasoning-v1` prompt asks the model to distinguish causal strategy
from wording, files, and surface implementation. The provider returns `repeat`, `different`, or
`partial`, confidence, short product copy, repeated/new strategy descriptions, supporting attempt IDs
and reasons, the unresolved issue, and a possible different angle. Watchtower validates this response.
It never stores or requests hidden chain-of-thought.

Run a processed session with:

```sh
OPENAI_API_KEY=... npm run watchtower:reason -- /path/to/inspection.json balanced
```

Only compact attempt summaries and possible fragment-group IDs leave the machine. API credentials stay
in the environment. Every result is stored under `<session>/reasoning/<comparison-id>.json`, including
inputs, prior IDs, fragment groups, prompt version, model, structured response, parsed judgment,
sensitivity, surfacing decision, latency, token usage, optional cost, errors, and cache status.

## Cost, caching, and quiet failure

The comparison ID is a SHA-256 digest of prompt version, model, and compact inputs. A completed result
is reused without another API call; sensitivity is recalculated locally. At most six prior summaries,
eight actions/files/evidence entries, and four caveats per attempt are transmitted. Configure
`WATCHTOWER_INPUT_COST_PER_MILLION` and `WATCHTOWER_OUTPUT_COST_PER_MILLION` to record an estimate using
the provider's token counts; no price is guessed when rates are not configured.

Calls time out after eight seconds and malformed/API failures are retried once. Both errors are recorded.
After failure, the engine returns `status: unavailable`, a null judgment, and `shouldSurface: false`.
It never blocks or controls Claude Code.

## Sensitivity

Thresholds are centralized in `reasoning/decision.ts`:

| Mode | Repeat | Partial |
| --- | ---: | ---: |
| cautious | 0.90 | never |
| balanced (default) | 0.72 | 0.85 |
| aggressive | 0.55 | 0.60 |

`different` is never surfaced. Low-confidence insufficient-evidence results remain quiet.

## Evaluation status

The contract and failure plumbing are tested for the seven required comparison scenarios with a
scripted provider. This proves structured inputs, parsing, fragmentation context, caching, thresholds,
and quiet failure; it does not claim that a live model made those semantic judgments. This checkout
contains no real captured Claude Code `inspection.json`, and `OPENAI_API_KEY` was not available, so the
required real-data/model evaluation could not be run in this environment.
