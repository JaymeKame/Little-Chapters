import type { RepeatJudgment, Sensitivity } from "./schema.ts";

export const DEFAULT_SENSITIVITY: Sensitivity = "balanced";
export const SURFACE_THRESHOLDS = {
  cautious: { repeat: .9, partial: Number.POSITIVE_INFINITY },
  balanced: { repeat: .72, partial: .82 },
  aggressive: { repeat: .55, partial: .6 },
} as const;

export function shouldSurface(judgment: RepeatJudgment, sensitivity: Sensitivity = DEFAULT_SENSITIVITY): boolean {
  if (judgment.classification === "different") return false;
  return judgment.confidence >= SURFACE_THRESHOLDS[sensitivity][judgment.classification];
}
