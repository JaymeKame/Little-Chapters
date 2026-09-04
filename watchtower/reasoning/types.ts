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

export type TokenUsage = { inputTokens: number; outputTokens: number };

export type ProviderResponse = {
  model: string;
  text: string;
  tokenUsage?: TokenUsage;
  estimatedCostUsd?: number;
};

export interface ReasoningProvider {
  readonly model: string;
  complete(systemPrompt: string, input: unknown, signal: AbortSignal): Promise<ProviderResponse>;
}

export type ComparisonTrace = {
  comparisonId: string;
  createdAt: string;
  promptVersion: string;
  model: string;
  suppliedSummaries: AttemptSummary[];
  consideredPriorAttemptIds: string[];
  currentAttemptId: string;
  structuredModelResponse?: unknown;
  judgment: RepeatJudgment | null;
  sensitivity: Sensitivity;
  shouldSurface: boolean;
  latencyMs: number;
  tokenUsage?: TokenUsage;
  estimatedCostUsd?: number;
  errors: string[];
  cacheHit: boolean;
};

export type ReasoningDecision = { judgment: RepeatJudgment | null; shouldSurface: boolean; comparisonId: string; trace: ComparisonTrace };
