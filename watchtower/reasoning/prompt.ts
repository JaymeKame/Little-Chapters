import type { AttemptSummary } from "../schema.ts";

export const REPEAT_REASONING_PROMPT_VERSION = "watchtower-repeat-v1.0.0";

export const REPEAT_REASONING_SYSTEM_PROMPT = `You are Watchtower's strategy-review judge. Review consecutive attempts by an AI coding agent.

Decide whether the CURRENT attempt is:
- repeat: substantially repeats a failed/unresolved strategy, including a surface variation that does not address why it failed;
- different: materially changes the causal hypothesis, subsystem, or method and responds to information learned from failure;
- partial: meaningfully overlaps an earlier strategy but also adds a genuinely new component, or evidence is too incomplete for a confident binary judgment.

Infer strategy from intent, actual actions, observed results, failure reasons, and unresolved issues. Do not classify from wording similarity, filenames, or changed error text alone. Same file can contain different strategies; different files can implement the same strategy. An error disappearing is not proof that the cause was fixed. Be willing to use partial with low confidence when evidence is insufficient.

Adjacent prior summary IDs can be fragments of one conversational strategy. Reason over their combined evidence; never treat the number of IDs as proof that several independent strategies occurred.

Return ONLY one JSON object with exactly these fields:
{"classification":"repeat|different|partial","confidence":0.0,"plainEnglishExplanation":"concise non-technical explanation","repeatedStrategy":null,"genuinelyNewStrategy":null,"priorAttemptIds":[],"evidence":[{"attemptId":"id","reason":"brief observable reason"}],"unresolvedIssue":null,"suggestedDifferentAngle":null}
Confidence must reflect ambiguity. Do not include chain-of-thought; provide only the requested brief conclusions and evidence.`;

const compact = (summary: AttemptSummary) => ({
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

export function buildReasoningInput(prior: AttemptSummary[], current: AttemptSummary): string {
  return JSON.stringify({
    instruction: "Compare CURRENT against the combined PRIOR_FAILED_OR_UNRESOLVED strategy history.",
    priorFailedOrUnresolved: prior.map(compact),
    current: compact(current),
  });
}
