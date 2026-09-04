import type { RepeatJudgment } from "./types.ts";

const object = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

export function parseJudgment(text: string): RepeatJudgment {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const value = object(JSON.parse(cleaned));
  if (!(["repeat", "different", "partial"] as unknown[]).includes(value.classification)) throw new Error("Invalid classification");
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) throw new Error("Invalid confidence");
  if (typeof value.plainEnglishExplanation !== "string" || !value.plainEnglishExplanation.trim()) throw new Error("Missing explanation");
  const nullable = ["repeatedStrategy", "genuinelyNewStrategy", "unresolvedIssue", "suggestedDifferentAngle"] as const;
  for (const key of nullable) if (value[key] !== null && typeof value[key] !== "string") throw new Error(`Invalid ${key}`);
  if (!Array.isArray(value.priorAttemptIds) || !value.priorAttemptIds.every((id) => typeof id === "string")) throw new Error("Invalid priorAttemptIds");
  if (!Array.isArray(value.evidence) || !value.evidence.every((item) => typeof object(item).attemptId === "string" && typeof object(item).reason === "string")) throw new Error("Invalid evidence");
  return value as RepeatJudgment;
}
