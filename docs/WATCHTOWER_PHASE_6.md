# Watchtower V1: Phase 6 repeat reasoning

Phase 6 compares the newest Phase 5 `AttemptSummary` with up to six recent failed or unresolved summaries.
It does not change capture, normalization, segmentation, evidence extraction, or Phase 5 summarization.

## Architecture and privacy

`RepeatReasoningEngine` deterministically filters successful history, bounds and truncates summary fields,
marks adjacent same-problem attempt IDs as context groups, and sends only that compact JSON plus the
versioned system prompt to `ReasoningProvider`. The production provider calls Anthropic's Messages API
with a forced structured tool result. No raw events, transcript, source files, repository contents, or
environment data are transmitted.

The default model is `claude-haiku-4-5-20251001`; override it with `WATCHTOWER_REASONING_MODEL`. Set
`ANTHROPIC_API_KEY` explicitly. API cost is reported only when both `WATCHTOWER_INPUT_COST_PER_MTOK` and
`WATCHTOWER_OUTPUT_COST_PER_MTOK` are configured, avoiding stale hard-coded pricing.

```sh
npm run watchtower:reason -- ~/.watchtower/sessions/<id>/inspection.json
```

Each comparison has a SHA-256 identity over prompt version, model, and compact input. Identical calls are
cached in-process, making the identity suitable for downstream alert deduplication. Debug JSONL includes
supplied summaries, considered IDs, fragment context groups, prompt version, model, requested structured
response, parsed judgment, confidence, sensitivity, surfacing decision, latency, usage/cost, and errors.
It never stores chain-of-thought.

Provider timeout, rate limit, malformed response, missing credentials, and debug-write failures are
converted to non-surfacing results; they do not interrupt Claude Code.

## Sensitivity

Balanced is the default. Central thresholds are:

| Mode | Repeat | Partial |
| --- | ---: | ---: |
| Cautious | 0.90 | never |
| Balanced | 0.72 | 0.82 |
| Aggressive | 0.55 | 0.60 |

`different` never surfaces. Low-confidence ambiguous judgments therefore remain quiet.

## Current evaluation status

Focused provider-contract tests cover the seven requested semantic scenarios with structured model
responses, plus validation, thresholds, filtering, fragment context, caching, and quiet failure. They do
not substitute a mock's answer for a claim about live model quality. No captured real Claude Code
`inspection.json` or Anthropic credentials were available in this environment, so live provider and
real-data evaluation remain pending rather than being simulated.
