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

export type ReasoningUsage = { inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number };

export type ReasoningProviderResponse = {
  model: string;
  text: string;
  usage?: Omit<ReasoningUsage, "estimatedCostUsd">;
};

export interface ReasoningProvider {
  complete(request: { system: string; input: string; timeoutMs: number }): Promise<ReasoningProviderResponse>;
}

export type ComparisonTrace = {
  comparisonId: string;
  judgmentId?: string;
  createdAt: string;
  promptVersion: string;
  model?: string;
  suppliedSummaries: { prior: AttemptSummary[]; current: AttemptSummary };
  consideredPriorAttemptIds: string[];
  fragmentHandling: string;
  structuredModelResponse?: unknown;
  parsedJudgment?: RepeatJudgment;
  sensitivity: Sensitivity;
  shouldSurface: boolean;
  latencyMs: number;
  usage?: ReasoningUsage;
  cacheHit: boolean;
  parsingAndRetryErrors: string[];
  failure?: string;
};

export type ReasoningResult = {
  comparisonId: string;
  judgment: RepeatJudgment | null;
  shouldSurface: boolean;
  duplicate: boolean;
  trace: ComparisonTrace;
};
