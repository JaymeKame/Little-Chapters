import type { Attempt, AttemptSummary, FailureEvidence } from "../schema.ts";

export interface AttemptSummarizer { summarize(attempt: Attempt, evidence: FailureEvidence[]): Promise<AttemptSummary>; }

/** Local and deterministic: no transcript, source code, or repository data leaves the machine. */
export class DeterministicAttemptSummarizer implements AttemptSummarizer {
  async summarize(attempt: Attempt, evidence: FailureEvidence[]): Promise<AttemptSummary> {
    const reasons = [...new Set(evidence.map((item) => item.description))];
    return {
      attemptId: attempt.id,
      problemBeingAddressed: attempt.problem,
      intendedApproach: attempt.intendedApproach,
      actionsTaken: attempt.actionsTaken,
      importantFilesOrComponents: attempt.filesTouched,
      observedEvidence: [...attempt.evidenceObserved, ...reasons],
      inferredOutcome: attempt.inferredOutcome,
      failureReason: attempt.inferredOutcome === "failure" ? reasons.join("; ") || "Failure inferred from session events" : undefined,
      appearsToHaveAddressed: attempt.intendedApproach,
      mayRemainUnresolved: attempt.inferredOutcome === "success" ? "Nothing indicated by the captured evidence" : attempt.problem,
      uncertaintyAndCaveats: ["Attempt boundaries and intent are heuristic.", ...(attempt.segmentationConfidence < .75 ? ["The session ended without a strong semantic boundary."] : [])],
    };
  }
}
