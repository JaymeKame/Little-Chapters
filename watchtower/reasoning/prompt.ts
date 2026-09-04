import type { CompactAttemptSummary } from "./types.ts";

export const REPEAT_REASONING_PROMPT_VERSION = "watchtower-repeat-v1.0.0";

export const REPEAT_REASONING_SYSTEM_PROMPT = `You are Watchtower's strategy-review judge. Review consecutive attempts by an AI coding agent.

Classify the newest attempt as exactly one of:
- repeat: substantially repeats a failed/unresolved strategy or only changes surface implementation without addressing why it failed.
- different: materially changes the causal hypothesis, subsystem, or method and addresses information learned from failure.
- partial: meaningfully overlaps a failed approach but also introduces a genuinely new direction, or the evidence is ambiguous.

Infer strategy from intent, actual actions, outcome, failure reason, and unresolved issue. Do not use wording, file overlap, or file difference alone. A disappearing error does not prove the underlying issue was fixed. Adjacent attempt IDs may be fragments of one conversational strategy; reason across the supplied contextGroups and never treat the count of IDs as proof of separate strategies. Be willing to use partial with low confidence when evidence is insufficient.

Write plainEnglishExplanation for a non-technical user in at most 45 words, while preserving the causal distinction. Do not reveal chain-of-thought. Return only one JSON object matching the requested schema. Confidence must be a number from 0 to 1.`;

export function buildReasoningInput(prior: CompactAttemptSummary[], current: CompactAttemptSummary, contextGroups: unknown): string {
  return JSON.stringify({
    task: "Decide whether currentAttempt is meaningfully different from prior failed or unresolved strategy context.",
    outputSchema: {
      classification: "repeat | different | partial",
      confidence: "number 0..1",
      plainEnglishExplanation: "string <= 45 words",
      repeatedStrategy: "string | null",
      genuinelyNewStrategy: "string | null",
      priorAttemptIds: "string[]",
      evidence: [{ attemptId: "string", reason: "brief observable reason" }],
      unresolvedIssue: "string | null",
      suggestedDifferentAngle: "string | null",
    },
    contextGroups,
    priorFailedOrUnresolvedAttempts: prior,
    currentAttempt: current,
  });
}
