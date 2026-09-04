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

export type ReasoningUsage = {
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
};

export type ProviderResponse = {
  model: string;
  text: string;
  structuredResponse?: unknown;
  usage?: ReasoningUsage;
};

export type ReasoningProvider = {
  readonly model: string;
  complete(systemPrompt: string, input: string, signal: AbortSignal): Promise<ProviderResponse>;
};

export type ContextGroup = {
  groupId: string;
  reason: string;
  attemptIds: string[];
};

export type ReasoningTrace = {
  comparisonId: string;
  createdAt: string;
  promptVersion: string;
  model: string;
  sensitivity: Sensitivity;
  suppliedSummaries: Array<Partial<AttemptSummary>>;
  consideredPriorAttemptIds: string[];
  contextGroups: ContextGroup[];
  structuredModelResponse: unknown | null;
  parsedJudgment: RepeatJudgment | null;
  shouldSurface: boolean;
  cacheHit: boolean;
  latencyMs: number;
  usage: ReasoningUsage | null;
  errors: string[];
};

export type ReasoningResult = {
  status: "evaluated" | "insufficient_history" | "failed";
  judgment: RepeatJudgment | null;
  shouldSurface: boolean;
  duplicate: boolean;
  trace: ReasoningTrace;
};
