# Watchtower V1 Phase 6: repeat reasoning

Phase 6 compares the newest Phase 5 `AttemptSummary` with up to six recent failed or unresolved
summaries. It does not modify capture, normalization, segmentation, evidence extraction, or Phase 5
summarization, and it does not implement an alert UI.

## Architecture and provider

`RepeatReasoningEngine` performs deterministic eligibility filtering, compact prompt construction,
fragment-context annotation, comparison identity, caching, schema validation, retry, observability,
and sensitivity evaluation. The final semantic classification always comes from the configured LLM;
there is no text-similarity classifier.

The initial provider is Anthropic's Messages API with model `claude-sonnet-4-5-20250929` by default.
Set `WATCHTOWER_REASONING_MODEL` to select another model. The system prompt is versioned as
`watchtower-repeat-v1.0.0`, uses temperature zero, and requests no chain-of-thought—only the required
judgment, concise explanation, and evidence.

```sh
ANTHROPIC_API_KEY=... npm run watchtower:reason -- summaries.json balanced
```

The input file is an ordered JSON array of Phase 5 summaries, with the current attempt last. Output is
written to `<input>.reasoning.json`. Reasoning errors, including timeouts, rate limits, and malformed
responses, return a non-surfacing advisory failure rather than blocking Claude Code.

## Segmentation tolerance

Adjacent prior summaries with the same problem label, or with a missing/generic problem label, are
annotated as a possible fragment group. These groups and their reason are recorded in the trace. The
LLM is explicitly instructed to reason across possible fragments and not treat attempt-ID count as
evidence of independent strategies. Grouping does not change or merge Phase 1–5 records.

## Sensitivity and deduplication

Thresholds are centralized:

| Sensitivity | Repeat | Partial |
| --- | ---: | ---: |
| Cautious | 0.90 | never |
| Balanced (default) | 0.72 | 0.82 |
| Aggressive | 0.55 | 0.58 |

`different` never surfaces. A SHA-256 identity covers the prompt version, model, and exact compact
comparison input. Successful traces are stored in an owner-only local cache. An identical comparison
returns the cached judgment with `duplicate: true`, allowing downstream code to avoid repeat alerts.

## Privacy, tokens, and inspection

Only compact Phase 5 fields are transmitted: attempt ID, problem, intended approach, actions, important
files/components, evidence, outcome, failure reason, addressed scope, unresolved scope, and caveats.
No raw transcript, raw event, repository, or source-file contents are sent.

Every trace retains supplied summaries, considered IDs, fragment groups, prompt version, model,
structured provider response, parsed judgment, confidence, sensitivity, surfacing decision, latency,
token usage, optional estimated cost, cache status, and parsing/retry errors. API cost is calculated only
when explicit `WATCHTOWER_INPUT_COST_PER_MILLION` and `WATCHTOWER_OUTPUT_COST_PER_MILLION` values are
configured, avoiding stale hard-coded prices.

## Evaluation status

No real Phase 1–5 captured session exists in this checkout, and no `ANTHROPIC_API_KEY` is available.
Therefore a real-session/provider evaluation cannot be honestly reported from this environment. The
focused tests use an injected fake provider to validate all seven required classifications as returned
by an LLM boundary, prompt/context plumbing, fragment grouping, parsing retry, safe failure, cache
deduplication, observability, and sensitivity behavior. They do not claim to validate model quality.
