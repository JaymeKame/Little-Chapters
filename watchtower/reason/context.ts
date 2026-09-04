import type { AttemptSummary } from "../schema.ts";
import type { ComparisonContext } from "./types.ts";

const MAX_PRIOR_ATTEMPTS = 6;
const genericProblems = new Set(["", "problem not explicitly stated", "unknown", "unspecified"]);
const normalize = (value: string | undefined) => (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();

function compact(summary: AttemptSummary): AttemptSummary {
  return {
    attemptId: summary.attemptId,
    problemBeingAddressed: summary.problemBeingAddressed,
    intendedApproach: summary.intendedApproach,
    actionsTaken: summary.actionsTaken?.slice(0, 8) ?? [],
    importantFilesOrComponents: summary.importantFilesOrComponents?.slice(0, 8) ?? [],
    observedEvidence: summary.observedEvidence?.slice(0, 8) ?? [],
    inferredOutcome: summary.inferredOutcome,
    failureReason: summary.failureReason,
    appearsToHaveAddressed: summary.appearsToHaveAddressed,
    mayRemainUnresolved: summary.mayRemainUnresolved,
    uncertaintyAndCaveats: summary.uncertaintyAndCaveats?.slice(0, 4) ?? [],
  };
}

/** Grouping is contextual only; the LLM remains the semantic judge. */
export function buildComparisonContext(history: AttemptSummary[], current: AttemptSummary): ComparisonContext {
  const eligible = history.filter((attempt) => attempt.attemptId !== current.attemptId && attempt.inferredOutcome !== "success").slice(-MAX_PRIOR_ATTEMPTS).map(compact);
  const fragmentGroups: ComparisonContext["fragmentGroups"] = [];
  for (const attempt of eligible) {
    const prior = fragmentGroups.at(-1);
    const problem = normalize(attempt.problemBeingAddressed);
    const sameProblem = prior && prior.attemptIds.some((id) => normalize(eligible.find((item) => item.attemptId === id)?.problemBeingAddressed) === problem);
    const missingProblem = genericProblems.has(problem);
    if (prior && (sameProblem || missingProblem)) {
      prior.attemptIds.push(attempt.attemptId);
      prior.reason = sameProblem ? "adjacent summaries name the same problem" : "adjacent summary has no independent problem statement";
    } else fragmentGroups.push({ groupId: `fragment-${fragmentGroups.length + 1}`, attemptIds: [attempt.attemptId], reason: "separate contiguous context" });
  }
  return { priorAttempts: eligible, currentAttempt: compact(current), fragmentGroups };
}
