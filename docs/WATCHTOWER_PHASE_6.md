# Watchtower V1: Phase 6 repeat reasoning

Phase 6 compares the newest Phase 5 `AttemptSummary` with up to six recent failed or unresolved
summaries. It does not read transcripts, source files, raw events, or repository contents. Final
classification is performed by an LLM, not by file overlap or text-similarity scoring.

## Provider and configuration

The V1 provider is Anthropic's Messages API. Both `ANTHROPIC_API_KEY` and an explicit
`WATCHTOWER_REASONING_MODEL` are required; Watchtower does not silently select or upgrade a model.
Run a completed inspection with:

```sh
npm run watchtower:reason -- ~/.watchtower/sessions/<session-id>/inspection.json
```

Optional `WATCHTOWER_SENSITIVITY` values are `cautious`, `balanced` (default), and `aggressive`.
The provider receives only the versioned system instructions, compact Phase 5 summaries, and
inspectable adjacency groups that warn it about possible segmentation fragments. No hidden reasoning
is requested or stored.

## Decisions, failures, and cost

The structured judgment is `repeat`, `different`, or `partial`, with confidence, a concise user-facing
explanation, repeated/new strategies, evidence references, unresolved issue, and a possible different
angle. Cautious surfaces repeats at 0.90; balanced surfaces repeats at 0.72 and partials at 0.82;
aggressive surfaces repeats at 0.55 and partials at 0.58. Different attempts never surface.

Inputs have a deterministic identity including prompt version, provider, and model. Successful results
are cached locally and reused without another API call. Debug traces include supplied summaries,
considered IDs, fragment groups, prompt version, provider/model, structured response, parsed judgment,
sensitivity decision, latency, token usage, optional cost, retry errors, and cache status.

Calls time out after 12 seconds and malformed/API failures retry once. A failure returns a non-surfacing
debug trace and never blocks Claude Code. Token usage comes from the provider. Cost is only calculated
when explicit per-million-token prices are supplied to the engine; it is otherwise `null` rather than
guessing a potentially stale price.

## Evaluation status

No real Phase 1–5 capture exists in this checkout or `~/.watchtower`, and no reasoning credentials or
model were configured. Consequently no real-session reasoning call was made. Fixture-backed contract
tests cover the seven required semantic scenarios through an injected LLM provider, but do not replace
the outstanding real-data evaluation.
