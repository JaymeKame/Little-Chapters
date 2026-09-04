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
export type ReasoningProviderResponse = {
  model: string;
  rawResponse: unknown;
  structuredResponse: unknown;
  usage?: ModelUsage;
  estimatedCostUsd?: number;
};

export interface ReasoningProvider {
  readonly model: string;
  judge(systemPrompt: string, input: ReasoningPromptInput, signal: AbortSignal): Promise<ReasoningProviderResponse>;
}

export type ReasoningPromptInput = {
  priorAttempts: AttemptSummary[];
  currentAttempt: AttemptSummary;
  adjacentContextGroups: string[][];
};

export type ComparisonDebugRecord = {
  comparisonId: string;
  createdAt: string;
  promptVersion: string;
  model: string;
  suppliedSummaries: ReasoningPromptInput;
  consideredPriorAttemptIds: string[];
  adjacentContextGroups: string[][];
  structuredModelResponse?: unknown;
  parsedJudgment?: RepeatJudgment;
  sensitivity: Sensitivity;
  shouldSurface: boolean;
  latencyMs: number;
  usage?: ModelUsage;
  estimatedCostUsd?: number;
  errors: string[];
  cacheHit: boolean;
};

export type ReasoningResult = {
  status: "judged" | "insufficient_history" | "provider_error";
  comparisonId: string;
  judgment?: RepeatJudgment;
  shouldSurface: boolean;
  debug: ComparisonDebugRecord;
};
