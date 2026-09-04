# Watchtower V1: Phase 6 repeat reasoning

Phase 6 compares the newest Phase 5 `AttemptSummary` with up to six adjacent prior summaries whose
outcomes are failed or unresolved. It does not alter capture, normalization, segmentation, evidence,
or summarization and does not implement an alert UI.

## Architecture

`RepeatReasoningEngine` compacts only Phase 5 summaries, constructs the versioned
`watchtower-repeat-v1.0.0` prompt, and asks an LLM for a strict `repeat | different | partial` judgment.
The prompt explicitly reasons about causal strategy rather than wording or files, and tells the model
to treat adjacent summaries as possible fragments of one strategy. Fragment IDs and every supplied
summary remain visible in the comparison trace.

The default provider calls Anthropic's Messages API with `claude-haiku-4-5` (override with
`WATCHTOWER_REASONING_MODEL`). Set `ANTHROPIC_API_KEY` locally. The only transmitted material is the
versioned system prompt and compact Phase 5 summaries: problem, intent, actions, components, evidence,
outcome, failure reason, addressed/unresolved descriptions, caveats, and attempt IDs. No transcript,
raw event, source file, or repository content is sent.

```sh
npm run watchtower:reason -- /path/to/inspection.json balanced
```

The command accepts either a Phase 5 `inspection.json` or a summary array. The final summary is current;
earlier entries are history. Calls use a 700-output-token ceiling,
zero temperature, timeout, and at most one retry. Provider token usage is recorded. Cost is optional
because a reliable estimate requires current model pricing; providers may populate it rather than
embedding stale prices.

## Policy and failure behavior

Thresholds are centralized:

| Sensitivity | repeat | partial |
| --- | ---: | ---: |
| cautious | 0.90 | never |
| balanced (default) | 0.72 | 0.85 |
| aggressive | 0.55 | 0.58 |

`different` never surfaces. A SHA-256 identity covers the prompt version, model, and compact input.
The local JSON store reuses completed judgments across processes, preventing duplicate provider calls
and downstream alerts for identical comparisons. A caller may use the in-memory store instead.

Each trace records supplied summaries, considered IDs, prompt version, model, structured response,
parsed judgment, confidence, sensitivity, surface decision, latency, token usage, optional cost,
cache status, and parsing/provider errors. It stores no hidden chain-of-thought. Timeouts, rate limits,
unavailable providers, and malformed responses return a null judgment with `shouldSurface: false` after
one retry; they never block Claude Code.

## Evaluation status

The seven required strategy scenarios are contract-tested through a recording LLM provider, including
collective fragmented-history context, low-confidence suppression, caching, policy, and quiet failure.
These tests validate orchestration and expected semantic contracts; they are not presented as live
model quality evaluation. This checkout contains no captured `inspection.json`, and no
`ANTHROPIC_API_KEY` is configured, so real-session/provider evaluation could not run here.
