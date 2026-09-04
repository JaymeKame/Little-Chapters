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

export type ComparisonContext = {
  priorAttempts: AttemptSummary[];
  currentAttempt: AttemptSummary;
  fragmentGroups: Array<{ groupId: string; attemptIds: string[]; reason: string }>;
};

export type ReasoningTrace = {
  comparisonId: string;
  judgmentId?: string;
  promptVersion: string;
  model: string;
  context: ComparisonContext;
  consideredPriorAttemptIds: string[];
  structuredModelResponse?: unknown;
  judgment?: RepeatJudgment;
  sensitivity: Sensitivity;
  shouldSurface: boolean;
  cached: boolean;
  latencyMs: number;
  tokenUsage?: TokenUsage;
  estimatedApiCostUsd?: number;
  errors: string[];
};

export type ReasoningResult =
  | { status: "judged"; judgment: RepeatJudgment; trace: ReasoningTrace }
  | { status: "skipped" | "unavailable"; reason: string; trace: ReasoningTrace };

export type ProviderResponse = { value: unknown; raw: unknown; usage?: TokenUsage; estimatedCostUsd?: number };

export interface ReasoningProvider {
  readonly model: string;
  judge(systemPrompt: string, input: unknown, signal: AbortSignal): Promise<ProviderResponse>;
}
