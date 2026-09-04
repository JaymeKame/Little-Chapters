import type { RepeatJudgment, Sensitivity } from "./types.ts";

export const DEFAULT_SENSITIVITY: Sensitivity = "balanced";

export const SURFACE_THRESHOLDS = {
  cautious: { repeat: .9, partial: Number.POSITIVE_INFINITY },
  balanced: { repeat: .75, partial: .85 },
  aggressive: { repeat: .55, partial: .6 },
} as const;

export function shouldSurface(judgment: RepeatJudgment | null, sensitivity: Sensitivity = DEFAULT_SENSITIVITY): boolean {
  if (!judgment || judgment.classification === "different") return false;
  return judgment.confidence >= SURFACE_THRESHOLDS[sensitivity][judgment.classification];
}
