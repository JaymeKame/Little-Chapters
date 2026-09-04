import type { RepeatJudgment, Sensitivity } from "./types.ts";

export const SENSITIVITY_THRESHOLDS = {
  cautious: { repeat: .9, partial: Number.POSITIVE_INFINITY },
  balanced: { repeat: .72, partial: .82 },
  aggressive: { repeat: .55, partial: .58 },
} as const;

export function shouldSurface(judgment: RepeatJudgment, sensitivity: Sensitivity = "balanced"): boolean {
  if (judgment.classification === "different") return false;
  return judgment.confidence >= SENSITIVITY_THRESHOLDS[sensitivity][judgment.classification];
}
