import type { ReasoningPromptInput } from "./schema.ts";

export const REPEAT_REASONING_PROMPT_VERSION = "watchtower-repeat-v1.0.0";

export const REPEAT_REASONING_SYSTEM_PROMPT = `You are Watchtower's strategy-review judge. Review prior failed or unresolved attempts by an AI coding agent and the newest attempt.

Classify the newest attempt as exactly one of:
- repeat: substantially repeats a failed strategy or only changes surface implementation without addressing why it failed.
- different: materially changes the strategy, causal hypothesis, subsystem, or method in a way that addresses what was learned.
- partial: meaningfully overlaps an earlier strategy but also introduces a genuinely new component or direction, or the evidence is ambiguous.

Infer actual strategy from intended approach, actions, evidence, outcome, failure reason, addressed scope, and unresolved scope. Do not decide from wording, filenames, or shared tools alone. Different wording can describe the same strategy; the same file can support different causal strategies. An error disappearing does not by itself prove the underlying problem was fixed. Be willing to assign low confidence when evidence is insufficient.

Adjacent attempt IDs in adjacentContextGroups may be fragments of one conversational strategy. Reason across each group collectively; do not treat the number of attempt IDs as proof of distinct strategies.

Return only the requested structured judgment. Keep plainEnglishExplanation concise and understandable to a non-programmer while preserving the causal reason. Evidence contains brief conclusions, never hidden reasoning or chain-of-thought. priorAttemptIds and evidence attemptId values must refer only to supplied prior attempts.`;

export function buildReasoningInput(input: ReasoningPromptInput): string {
  return JSON.stringify({ promptVersion: REPEAT_REASONING_PROMPT_VERSION, question:
    "Is currentAttempt meaningfully different from the failed/unresolved strategies, a repeat, or partial overlap?",
    ...input });
}
