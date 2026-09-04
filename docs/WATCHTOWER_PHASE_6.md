# Watchtower V1: Phase 6 reasoning

Phase 6 compares the newest Phase 5 `AttemptSummary` with up to eight preceding failed or unresolved
summaries. It does not read raw transcripts, repository files, normalized events, or source code.

The semantic decision is made by an LLM through the replaceable `ReasoningProvider` interface. The
included provider calls Anthropic's Messages API with temperature zero. The prompt is versioned as
`watchtower-repeat-v1.0.0`, asks for strict structured JSON, distinguishes surface changes from causal
strategy changes, and tells the model that adjacent attempt IDs may be fragments of one strategy.

Adjacent summaries with the same normalized problem statement, or summaries lacking explicit intent,
are placed in inspectable context groups. Grouping supplies context to the model; it does not make the
classification. The Phase 1–5 segmenter is unchanged.

## Run

Provide a JSON array of Phase 5 summaries in chronological order, with the current summary last:

```sh
ANTHROPIC_API_KEY=... npm run watchtower:reason -- summaries.json
```

`WATCHTOWER_REASONING_MODEL` selects the model. The default is `claude-sonnet-4-20250514`.
Only compact Phase 5 summary fields, context-group IDs/reasons, the output schema, and reasoning
instructions leave the machine. Full transcripts and repository contents are never sent.

Comparisons have a SHA-256 identity over prompt version, model, prior summaries, and current summary.
The CLI caches complete debug records locally in `~/.watchtower/reasoning`, preventing duplicate API
calls; cache hits return `shouldSurface: false`, preventing duplicate downstream surfaces for identical
inputs. Records include supplied summaries, prior IDs,
context groups, prompt version, provider/model, structured response, parsed judgment, sensitivity,
surface decision, latency, token usage, optional cost, cache state, and errors. No hidden reasoning is
requested or stored.

Provider and parsing failures return a null judgment and `shouldSurface: false`; they do not affect the
Claude Code session. API-cost estimation is only emitted when token usage and explicit per-million-token
prices are configured by the caller, avoiding stale hard-coded pricing.

## Sensitivity

Thresholds are centralized in `reasoning/sensitivity.ts`. `balanced` is the default.

| Mode | Repeat | Partial |
| --- | ---: | ---: |
| Cautious | 0.90 | never |
| Balanced | 0.75 | 0.85 |
| Aggressive | 0.55 | 0.60 |

`different`, null, and low-confidence judgments never surface.

## Environment evaluation status

No real Phase 1–5 capture or `ANTHROPIC_API_KEY` was available in this environment. Contract tests use
a provider test double to exercise seven required semantic scenarios and all engine plumbing, but are
not represented as a live-model or real-session evaluation.
