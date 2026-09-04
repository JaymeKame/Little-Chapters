import type { AttemptSummary } from "../schema.ts";
import type { ContextGroup } from "./types.ts";

export const REPEAT_REASONING_PROMPT_VERSION = "watchtower-repeat-v1.1.0";

export const REPEAT_REASONING_SYSTEM_PROMPT = `You are Watchtower's strategy-review engine. Review attempts by an AI coding agent and judge whether the newest attempt is a meaningfully different approach from prior failed or unresolved attempts.

Classify as:
- repeat: substantially repeats a failed strategy or changes only surface implementation without addressing why it failed.
- different: materially changes the causal hypothesis, subsystem, or method and addresses information learned from failure.
- partial: meaningful overlap plus a genuinely new component. Also use partial with low confidence when the evidence is too thin to choose repeat or different safely.

Infer strategy from intent, actual actions, evidence, failure reason, addressed scope, and unresolved scope. Compare what prior attempts tried, why they failed or remained unresolved, what the current attempt is doing, and whether it responds to what was learned. Never decide from wording similarity, shared files, or different files alone. A disappearing error is not proof the cause was fixed. Adjacent attempt IDs may be fragments of one conversational strategy; reason across indicated context groups and do not treat ID count as proof of independent attempts. Include every prior attempt that materially supports the judgment in priorAttemptIds and evidence; omit irrelevant attempts.

Write plainEnglishExplanation for a non-technical user in at most 45 words while preserving the causal distinction. Do not reveal chain-of-thought or provide hidden reasoning. Return only the requested judgment fields. confidence must be 0..1; confidence below 0.5 is appropriate for insufficient evidence. evidence items contain attemptId and a concise, observable reason. Nullable fields must be JSON null.`;

const compact = (summary: Partial<AttemptSummary>) => ({
  attemptId: summary.attemptId,
  problemBeingAddressed: summary.problemBeingAddressed,
  intendedApproach: summary.intendedApproach,
  actionsTaken: summary.actionsTaken,
  importantFilesOrComponents: summary.importantFilesOrComponents,
  observedEvidence: summary.observedEvidence,
  inferredOutcome: summary.inferredOutcome,
  failureReason: summary.failureReason,
  appearsToHaveAddressed: summary.appearsToHaveAddressed,
  mayRemainUnresolved: summary.mayRemainUnresolved,
  uncertaintyAndCaveats: summary.uncertaintyAndCaveats,
});

export function buildReasoningInput(
  prior: Array<Partial<AttemptSummary>>,
  current: Partial<AttemptSummary>,
  groups: ContextGroup[],
): string {
  return JSON.stringify({ promptVersion: REPEAT_REASONING_PROMPT_VERSION,
    task: "Compare CURRENT_ATTEMPT with relevant PRIOR_FAILED_OR_UNRESOLVED_ATTEMPTS.",
    contextGroups: groups,
    priorAttempts: prior.map(compact), currentAttempt: compact(current) });
}
