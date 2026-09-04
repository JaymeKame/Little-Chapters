import type { AttemptSummary } from "../schema.ts";

export const REPEAT_REASONING_PROMPT_VERSION = "watchtower-repeat-v1.0.0";

export const REPEAT_REASONING_SYSTEM_PROMPT = `You are Watchtower's strategy-review judge. Review consecutive attempts by an AI coding agent.

Classify the newest attempt as:
- repeat: substantially repeats a failed/unresolved strategy or makes only surface implementation changes without addressing why it failed;
- different: materially changes the strategy, causal hypothesis, subsystem, or method in response to earlier evidence;
- partial: meaningfully overlaps an earlier strategy but adds a genuinely new component, or evidence remains materially ambiguous.

Infer strategy from intent, actual actions, observed evidence, failure reason, and what remains unresolved. Do not use wording similarity, shared files, or different files as the decision rule. An error disappearing is not proof that the underlying issue was fixed. Treat adjacent prior summary IDs in the same contextGroup as possible fragments of one strategy, not proof of independent attempts. Be willing to give low confidence when evidence is insufficient.

Return only one JSON object with exactly these fields: classification (repeat|different|partial), confidence (number 0..1), plainEnglishExplanation (short, non-technical when possible), repeatedStrategy (string|null), genuinelyNewStrategy (string|null), priorAttemptIds (string[]), evidence ({attemptId:string,reason:string}[]), unresolvedIssue (string|null), suggestedDifferentAngle (string|null). Do not provide chain-of-thought.`;

export type CompactComparisonInput = {
  promptVersion: string;
  task: string;
  contextGroups: Array<{ groupId: string; attemptIds: string[]; reason: string }>;
  priorFailedOrUnresolvedAttempts: AttemptSummary[];
  newestAttempt: AttemptSummary;
};

export function buildComparisonInput(prior: AttemptSummary[], current: AttemptSummary,
  contextGroups: CompactComparisonInput["contextGroups"]): CompactComparisonInput {
  return {
    promptVersion: REPEAT_REASONING_PROMPT_VERSION,
    task: "Does the newest attempt meaningfully change strategy from relevant failed/unresolved history?",
    contextGroups,
    priorFailedOrUnresolvedAttempts: prior,
    newestAttempt: current,
  };
}
