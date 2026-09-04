import type { AttemptSummary } from "../schema.ts";

export const REPEAT_REASONING_PROMPT_VERSION = "watchtower-repeat-v1.0.0";

export const REPEAT_REASONING_SYSTEM_PROMPT = `You review consecutive attempts by an AI coding agent to solve one problem.
Classify the newest attempt as repeat, different, or partial relative to prior failed or unresolved attempts.

repeat: substantially repeats an earlier failed strategy, including surface implementation changes that do not address why it failed.
different: materially changes the causal hypothesis, subsystem, or method and addresses information learned from failure.
partial: meaningfully overlaps an earlier strategy but adds a genuinely new component or direction.

Infer strategy from intent, actual actions, failure evidence, and unresolved issues. Never decide from wording, filenames, or apparent error disappearance alone. Same files can contain different strategies; different files can contain the same strategy. Be willing to use partial and low confidence when evidence is insufficient.

Adjacent attempt summaries can be fragments of one conversational strategy. Reason over such fragments collectively and cite every relevant fragment ID; do not treat multiple IDs as proof of independent approaches.

Return only one JSON object with exactly these fields:
{"classification":"repeat|different|partial","confidence":0.0,"plainEnglishExplanation":"brief non-technical explanation","repeatedStrategy":null,"genuinelyNewStrategy":null,"priorAttemptIds":[],"evidence":[{"attemptId":"id","reason":"brief observable reason"}],"unresolvedIssue":null,"suggestedDifferentAngle":null}
Confidence must reflect ambiguity. Explanations must be concise and understandable without reading code. Do not reveal hidden reasoning or chain-of-thought.`;

function compact(summary: AttemptSummary): AttemptSummary {
  const limit = (items: string[]) => items.slice(0, 8).map((item) => item.slice(0, 500));
  return { ...summary,
    problemBeingAddressed: summary.problemBeingAddressed?.slice(0, 1000) ?? "",
    intendedApproach: summary.intendedApproach?.slice(0, 1000) ?? "",
    actionsTaken: limit(summary.actionsTaken ?? []),
    importantFilesOrComponents: limit(summary.importantFilesOrComponents ?? []),
    observedEvidence: limit(summary.observedEvidence ?? []),
    appearsToHaveAddressed: summary.appearsToHaveAddressed?.slice(0, 1000) ?? "",
    mayRemainUnresolved: summary.mayRemainUnresolved?.slice(0, 1000) ?? "",
    uncertaintyAndCaveats: limit(summary.uncertaintyAndCaveats ?? []),
  };
}

export function buildReasoningInput(prior: AttemptSummary[], current: AttemptSummary) {
  return {
    task: "Judge whether CURRENT is a meaningfully different strategy from relevant PRIOR failures/unresolved attempts.",
    priorAttemptsInChronologicalOrder: prior.map(compact),
    currentAttempt: compact(current),
  };
}
