import type { ComparisonInput } from "./types.ts";

export const REPEAT_REASONING_PROMPT_VERSION = "watchtower-repeat-reasoning-v1";

export const REPEAT_REASONING_INSTRUCTIONS = `You review consecutive attempts by an AI coding agent to solve a problem.
Judge whether the newest attempt is meaningfully different from relevant prior failed or unresolved attempts.

Classify as:
- repeat: substantially repeats a failed strategy or makes surface changes without addressing why it failed.
- different: materially changes the strategy, causal hypothesis, subsystem, or method and addresses information learned from failure.
- partial: meaningfully overlaps a failed strategy but adds a genuinely new component, or evidence is ambiguous.

Infer strategy from intent, actual actions, outcomes, failure reasons, and unresolved issues. Never decide from wording,
file overlap, or error disappearance alone. Different wording or files can implement the same strategy; the same file can
contain a different causal approach. Be willing to return partial with low confidence when evidence is insufficient.
Adjacent attempt IDs may be fragments of one conversational strategy. Treat adjacentFragmentGroups only as context
that should be reasoned over collectively, not proof of separate attempts or proof that strategies are identical.

The explanation is product copy for a non-technical user: concise, plain English, and causally informative.
Return only the requested JSON object. Do not include chain-of-thought.`;

export function buildReasoningInput(input: ComparisonInput, adjacentFragmentGroups: string[][]): string {
  return JSON.stringify({ promptVersion: REPEAT_REASONING_PROMPT_VERSION, task: "compare_newest_strategy_to_failed_or_unresolved_history",
    adjacentFragmentGroups, ...input });
}

export const REPEAT_JUDGMENT_JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["classification", "confidence", "plainEnglishExplanation", "repeatedStrategy", "genuinelyNewStrategy",
    "priorAttemptIds", "evidence", "unresolvedIssue", "suggestedDifferentAngle"],
  properties: {
    classification: { type: "string", enum: ["repeat", "different", "partial"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    plainEnglishExplanation: { type: "string" },
    repeatedStrategy: { type: ["string", "null"] },
    genuinelyNewStrategy: { type: ["string", "null"] },
    priorAttemptIds: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["attemptId", "reason"], properties: { attemptId: { type: "string" }, reason: { type: "string" } } } },
    unresolvedIssue: { type: ["string", "null"] },
    suggestedDifferentAngle: { type: ["string", "null"] },
  },
} as const;
