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

export type TokenUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };

export type ReasoningProviderResponse = {
  model: string;
  structuredResponse: unknown;
  tokenUsage?: TokenUsage;
};

export interface ReasoningProvider {
  readonly model: string;
  reason(instructions: string, input: string, signal: AbortSignal): Promise<ReasoningProviderResponse>;
}

export type CompactAttemptSummary = Partial<Omit<AttemptSummary, "attemptId">> & { attemptId: string };

export type ComparisonInput = {
  currentAttempt: CompactAttemptSummary;
  priorAttempts: CompactAttemptSummary[];
};

export type ComparisonTrace = {
  comparisonId: string;
  createdAt: string;
  status: "completed" | "unavailable";
  promptVersion: string;
  model: string;
  sensitivity: Sensitivity;
  attemptsSupplied: ComparisonInput;
  previousAttemptIdsConsidered: string[];
  adjacentFragmentGroups: string[][];
  structuredModelResponse?: unknown;
  judgment: RepeatJudgment | null;
  shouldSurface: boolean;
  latencyMs: number;
  tokenUsage?: TokenUsage;
  estimatedApiCostUsd?: number;
  errors: string[];
  cacheHit: boolean;
};
