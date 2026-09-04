import type { RepeatJudgment } from "./types.ts";

export function parseJudgment(value: unknown, allowedAttemptIds: Set<string>): RepeatJudgment {
  if (!value || typeof value !== "object") throw new Error("Reasoning response is not an object");
  const item = value as Record<string, unknown>;
  if (!(["repeat", "different", "partial"] as unknown[]).includes(item.classification)) throw new Error("Invalid classification");
  if (typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1) throw new Error("Invalid confidence");
  if (typeof item.plainEnglishExplanation !== "string" || !item.plainEnglishExplanation.trim()) throw new Error("Missing plain-English explanation");
  if (!Array.isArray(item.priorAttemptIds) || item.priorAttemptIds.some((id) => typeof id !== "string" || !allowedAttemptIds.has(id))) throw new Error("Response cited an unknown prior attempt");
  if (!Array.isArray(item.evidence) || item.evidence.some((entry) => !entry || typeof entry !== "object" || typeof (entry as Record<string, unknown>).reason !== "string" || !allowedAttemptIds.has(String((entry as Record<string, unknown>).attemptId)))) throw new Error("Invalid evidence citation");
  for (const field of ["repeatedStrategy", "genuinelyNewStrategy", "unresolvedIssue", "suggestedDifferentAngle"])
    if (item[field] !== null && typeof item[field] !== "string") throw new Error(`Invalid ${field}`);
  return item as RepeatJudgment;
}
