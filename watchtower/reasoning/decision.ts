import type { RepeatJudgment, Sensitivity } from "./types.ts";

export const SURFACE_THRESHOLDS = {
  cautious: { repeat: .9, partial: Infinity },
  balanced: { repeat: .72, partial: .82 },
  aggressive: { repeat: .55, partial: .58 },
} as const;

export function shouldSurface(judgment: RepeatJudgment | null, sensitivity: Sensitivity = "balanced"): boolean {
  if (!judgment || judgment.classification === "different") return false;
  return judgment.confidence >= SURFACE_THRESHOLDS[sensitivity][judgment.classification];
}
