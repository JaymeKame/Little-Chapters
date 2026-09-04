# Watchtower V1: Phase 6 reasoning engine

Phase 6 compares the newest Phase 5 `AttemptSummary` with up to six recent failed or unresolved
summaries. Successful attempts are excluded from comparison history. Adjacent summaries remain ordered
and the versioned model prompt explicitly says they may be fragments of one conversational strategy.
This grouping behavior and every considered ID are visible in the comparison trace. Phase 1–5 code is
unchanged.

## Provider and prompt

The semantic decision is made by an LLM, not a similarity score. `AnthropicReasoningProvider` calls the
Messages API with `ANTHROPIC_API_KEY` and the explicitly configured `WATCHTOWER_REASONING_MODEL`.
Prompt `watchtower-repeat-v1.0.0` defines repeat, different, and partial, warns against wording/file
similarity shortcuts, describes fragmented attempts, and requests only the structured judgment rather
than chain-of-thought.

Run a JSON array of Phase 5 summaries with:

```sh
ANTHROPIC_API_KEY=... WATCHTOWER_REASONING_MODEL=... \
  npm run watchtower:reason -- path/to/summaries.json
```

Only compact Phase 5 summaries and the versioned instruction are transmitted. Raw transcripts,
repository contents, source files, hook events, and normalized timelines are never included.
Provider credentials and model selection are explicit environment configuration.

The request is capped at 700 output tokens, uses at most six prior summaries, times out after eight
seconds by default, and records provider token usage. Estimated cost is recorded only when
`WATCHTOWER_INPUT_COST_PER_MILLION` and `WATCHTOWER_OUTPUT_COST_PER_MILLION` are configured.

## Decision, caching, and quiet failure

Surface thresholds are centralized:

| Sensitivity | repeat | partial |
| --- | ---: | ---: |
| cautious | 0.90 | never |
| balanced (default) | 0.72 | 0.85 |
| aggressive | 0.55 | 0.60 |

`different` never surfaces. A SHA-256 identity covers the prompt version and exact comparison inputs.
The CLI persists successful judgments locally and returns cached results for identical comparisons,
marking them as duplicates so downstream alert code can avoid spam.

Provider errors and malformed JSON are retried once. Exhausted failures return no judgment and never
surface or block the observed coding session. JSONL traces record summaries supplied, IDs considered,
prompt version, model, raw structured response, parsed result, sensitivity, surface decision, latency,
usage/cost, cache state, and parse/retry failures. They contain no hidden reasoning.

## Evaluation status

Focused plumbing tests cover the seven required semantic scenarios using an injected fixture judge,
plus thresholds, caching, and malformed-response behavior. They validate orchestration and the provider
contract, not the quality of a live model. `npm run test:watchtower:reasoning-live` exercises all seven
expectations against the configured LLM and skips explicitly when credentials are absent. No real captured Claude Code session data or configured
reasoning-provider credentials are present in this environment, so real-data/model evaluation remains
blocked and is not claimed.
