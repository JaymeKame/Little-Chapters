import type { RepeatJudgment, Sensitivity } from "./types.ts";

export const DEFAULT_SENSITIVITY: Sensitivity = "balanced";

export const SURFACE_THRESHOLDS: Readonly<Record<Sensitivity, { repeat: number; partial: number }>> = {
  cautious: { repeat: .9, partial: Infinity },
  balanced: { repeat: .72, partial: .85 },
  aggressive: { repeat: .55, partial: .6 },
};

export function shouldSurface(judgment: RepeatJudgment, sensitivity: Sensitivity = DEFAULT_SENSITIVITY): boolean {
  if (judgment.classification === "different") return false;
  return judgment.confidence >= SURFACE_THRESHOLDS[sensitivity][judgment.classification];
}
