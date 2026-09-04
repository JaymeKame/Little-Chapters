import type { AttemptSummary } from "../schema.ts";

export type RepeatClassification = "repeat" | "different" | "partial";
export type Sensitivity = "cautious" | "balanced" | "aggressive";

export type RepeatJudgment = {
  classification: RepeatClassification;
  confidence: number;
  plainEnglishExplanation: string;
  repeatedStrategy: string | null;
  genuinelyNewStrategy: string | null;
  priorAttemptIds: string[];
  evidence: Array<{ attemptId: string; reason: string }>;
  unresolvedIssue: string | null;
  suggestedDifferentAngle: string | null;
};

export type ModelUsage = { inputTokens?: number; outputTokens?: number };
export type ModelResponse = { text: string; raw: unknown; usage?: ModelUsage };

export interface ReasoningProvider {
  readonly name: string;
  readonly model: string;
  complete(system: string, input: string, signal: AbortSignal): Promise<ModelResponse>;
}

export type ComparisonTrace = {
  comparisonId: string;
  status: "judged" | "failed" | "insufficient_history";
  promptVersion: string;
  provider: string;
  model: string;
  summariesSupplied: { prior: AttemptSummary[]; current: AttemptSummary };
  consideredPriorAttemptIds: string[];
  contextGroups: Array<{ groupId: string; attemptIds: string[]; reason: string }>;
  structuredModelResponse: unknown | null;
  judgment: RepeatJudgment | null;
  sensitivity: Sensitivity;
  shouldSurface: boolean;
  latencyMs: number;
  tokenUsage: ModelUsage | null;
  estimatedApiCostUsd: number | null;
  errors: string[];
  cacheHit: boolean;
  createdAt: string;
};
