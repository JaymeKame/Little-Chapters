import type { AttemptSummary } from "../schema.ts";

export type RepeatClassification = "repeat" | "different" | "partial";
export type Sensitivity = "cautious" | "balanced" | "aggressive";

export type ReasoningEvidence = { attemptId: string; reason: string };

export type RepeatJudgment = {
  classification: RepeatClassification;
  confidence: number;
  plainEnglishExplanation: string;
  repeatedStrategy: string | null;
  genuinelyNewStrategy: string | null;
  priorAttemptIds: string[];
  evidence: ReasoningEvidence[];
  unresolvedIssue: string | null;
  suggestedDifferentAngle: string | null;
};

export type CompactAttemptSummary = Partial<Omit<AttemptSummary, "attemptId">> & { attemptId: string };

export type AttemptContextGroup = {
  groupId: string;
  reason: "standalone_context" | "adjacent_same_problem" | "adjacent_fragment_context";
  attemptIds: string[];
};

export type ModelUsage = { inputTokens?: number; outputTokens?: number };
export type ReasoningModelResponse = {
  text: string;
  raw?: unknown;
  usage?: ModelUsage;
};

export type ReasoningRequest = {
  system: string;
  input: string;
  model: string;
  maxOutputTokens: number;
};

export interface ReasoningProvider {
  readonly name: string;
  complete(request: ReasoningRequest, signal: AbortSignal): Promise<ReasoningModelResponse>;
}

export type ComparisonDebugRecord = {
  comparisonId: string;
  createdAt: string;
  promptVersion: string;
  model: string;
  provider: string;
  summariesSupplied: { prior: CompactAttemptSummary[]; current: CompactAttemptSummary };
  priorAttemptIdsConsidered: string[];
  contextGroups: AttemptContextGroup[];
  structuredModelResponse: unknown | null;
  judgment: RepeatJudgment | null;
  sensitivity: Sensitivity;
  shouldSurface: boolean;
  latencyMs: number;
  usage: ModelUsage | null;
  estimatedCostUsd: number | null;
  cacheHit: boolean;
  errors: string[];
};

export type ComparisonResult = {
  comparisonId: string;
  judgment: RepeatJudgment | null;
  shouldSurface: boolean;
  cached: boolean;
  debug: ComparisonDebugRecord;
};
