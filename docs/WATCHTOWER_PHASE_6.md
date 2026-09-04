# Watchtower Phase 6: repeat reasoning

Phase 6 compares the newest Phase 5 `AttemptSummary` with up to six prior failed or unresolved summaries. It does not inspect raw transcripts, source files, or repository contents. It does not modify Phase 1–5 or implement an alert UI.

## Architecture

`RepeatReasoningEngine.compare()` compacts the existing summary fields, records adjacent fragment groups, creates a deterministic identity from prompt version/model/input, checks its cache, calls an injected semantic reasoning provider, validates its structured response, and applies the centralized sensitivity policy. `watchtower-repeat-reasoning-v1` explicitly distinguishes strategy from wording/file overlap and instructs the model to reason collectively across fragmented summaries.

The production adapter uses the OpenAI Responses API with strict JSON-schema output. Configure `OPENAI_API_KEY`, optional `OPENAI_BASE_URL`, and optional `WATCHTOWER_REASONING_MODEL` (default `gpt-5-mini`). `WATCHTOWER_INPUT_USD_PER_MILLION` and `WATCHTOWER_OUTPUT_USD_PER_MILLION` enable cost estimates without embedding prices that will become stale.

```sh
npm run watchtower:reason -- /path/to/attempt-summaries.json balanced
```

The command writes an owner-only `.reasoning.json` trace containing compact inputs, considered attempt IDs, fragment groups, prompt version, model, requested structured provider output, parsed judgment, sensitivity decision, latency, usage/cost when supplied, cache status, and errors. It never stores the provider's full response or hidden chain-of-thought.

## Surface policy

| Sensitivity | Repeat | Partial |
| --- | ---: | ---: |
| Cautious | >= 0.90 | never |
| Balanced (default) | >= 0.72 | >= 0.82 |
| Aggressive | >= 0.55 | >= 0.55 |

`different` is never surfaced. An unavailable, timed-out, malformed, or uncited response returns an advisory `unavailable` result with `shouldSurface: false`; it never blocks Claude Code. One retry is allowed for invalid provider output.

## Privacy and cost

Only the listed Phase 5 summary fields, fragment grouping, and prompt version are transmitted. No raw events, transcript, arbitrary source code, or repository are sent. Context is capped at six failed/unresolved attempts and long arrays are capped. Identical version/model/input uses a deterministic comparison ID and an owner-only local cache (default `~/.watchtower/reasoning-cache.json`), preventing repeat API calls and duplicate downstream judgment IDs across processes. Token usage is recorded when available; price estimates are reported only when explicit current rates are configured.

## Evaluation status

The seven required scenarios are covered through the provider boundary with structured mocked model judgments, plus cache, policy, retry, and quiet-failure tests. They validate orchestration and contract behavior, not the semantic quality of a specific hosted model. No real Phase 1–5 capture or reasoning API credential exists in this environment, so real-session/model evaluation remains unavailable and is not claimed.
