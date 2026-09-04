import type { RepeatJudgment } from "./schema.ts";

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

export function parseRepeatJudgment(value: unknown, allowedPriorIds: Set<string>): RepeatJudgment {
  const item = record(value);
  if (!(["repeat", "different", "partial"] as unknown[]).includes(item.classification)) throw new Error("Invalid classification");
  if (typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1) throw new Error("Confidence must be between 0 and 1");
  if (typeof item.plainEnglishExplanation !== "string" || !item.plainEnglishExplanation.trim()) throw new Error("Explanation is required");
  const nullable = (name: string): string | null => {
    const candidate = item[name];
    if (candidate === null || typeof candidate === "string") return candidate;
    throw new Error(`${name} must be a string or null`);
  };
  if (!Array.isArray(item.priorAttemptIds) || !item.priorAttemptIds.every((id) => typeof id === "string" && allowedPriorIds.has(id)))
    throw new Error("Response referenced an unknown prior attempt");
  if (!Array.isArray(item.evidence)) throw new Error("Evidence must be an array");
  const evidence = item.evidence.map((entry) => {
    const parsed = record(entry);
    if (typeof parsed.attemptId !== "string" || !allowedPriorIds.has(parsed.attemptId) || typeof parsed.reason !== "string")
      throw new Error("Invalid evidence entry");
    return { attemptId: parsed.attemptId, reason: parsed.reason };
  });
  return { classification: item.classification as RepeatJudgment["classification"], confidence: item.confidence,
    plainEnglishExplanation: item.plainEnglishExplanation, repeatedStrategy: nullable("repeatedStrategy"),
    genuinelyNewStrategy: nullable("genuinelyNewStrategy"), priorAttemptIds: item.priorAttemptIds as string[], evidence,
    unresolvedIssue: nullable("unresolvedIssue"), suggestedDifferentAngle: nullable("suggestedDifferentAngle") };
}
