import { createHash } from "node:crypto";
import { shouldSurface } from "./decision.ts";
import { buildReasoningInput, REPEAT_REASONING_INSTRUCTIONS, REPEAT_REASONING_PROMPT_VERSION } from "./prompt.ts";
import { MemoryReasoningStore, type ReasoningStore } from "./store.ts";
import type { CompactAttemptSummary, ComparisonInput, ComparisonTrace, ReasoningProvider, RepeatJudgment, Sensitivity } from "./types.ts";

export type ReasoningEngineOptions = { provider: ReasoningProvider; store?: ReasoningStore; timeoutMs?: number;
  inputCostPerMillionTokens?: number; outputCostPerMillionTokens?: number };

export class RepeatReasoningEngine {
  private readonly store: ReasoningStore;
  private readonly options: ReasoningEngineOptions;
  constructor(options: ReasoningEngineOptions) { this.options = options; this.store = options.store ?? new MemoryReasoningStore(); }

  async compare(history: CompactAttemptSummary[], currentAttempt: CompactAttemptSummary, sensitivity: Sensitivity = "balanced"): Promise<ComparisonTrace> {
    const priorAttempts = history.filter((attempt) => attempt.attemptId !== currentAttempt.attemptId && attempt.inferredOutcome !== "success").slice(-6);
    const input: ComparisonInput = { priorAttempts: priorAttempts.map(compact), currentAttempt: compact(currentAttempt) };
    const adjacentFragmentGroups = fragmentContext(priorAttempts);
    const providerInput = buildReasoningInput(input, adjacentFragmentGroups);
    const comparisonId = createHash("sha256").update(JSON.stringify({ prompt: REPEAT_REASONING_PROMPT_VERSION,
      model: this.options.provider.model, input })).digest("hex");
    const cached = await this.store.get(comparisonId);
    if (cached?.status === "completed") return { ...cached, sensitivity,
      shouldSurface: cached.judgment ? shouldSurface(cached.judgment, sensitivity) : false, cacheHit: true };

    const started = Date.now(); const errors: string[] = []; let structuredModelResponse: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 8_000);
      try {
        const response = await this.options.provider.reason(REPEAT_REASONING_INSTRUCTIONS, providerInput, controller.signal);
        structuredModelResponse = response.structuredResponse;
        const judgment = parseJudgment(structuredModelResponse, priorAttempts.map((item) => item.attemptId), currentAttempt.attemptId);
        const trace: ComparisonTrace = { comparisonId, createdAt: new Date().toISOString(), status: "completed",
          promptVersion: REPEAT_REASONING_PROMPT_VERSION, model: response.model, sensitivity, attemptsSupplied: input,
          previousAttemptIdsConsidered: priorAttempts.map((item) => item.attemptId), adjacentFragmentGroups,
          structuredModelResponse, judgment, shouldSurface: shouldSurface(judgment, sensitivity), latencyMs: Date.now() - started,
          tokenUsage: response.tokenUsage, estimatedApiCostUsd: estimateCost(response.tokenUsage, this.options), errors, cacheHit: false };
        await this.store.put(trace); return trace;
      } catch (error) { errors.push(`attempt ${attempt + 1}: ${error instanceof Error ? error.message : String(error)}`); }
      finally { clearTimeout(timeout); }
    }
    const failed: ComparisonTrace = { comparisonId, createdAt: new Date().toISOString(), status: "unavailable",
      promptVersion: REPEAT_REASONING_PROMPT_VERSION, model: this.options.provider.model, sensitivity, attemptsSupplied: input,
      previousAttemptIdsConsidered: priorAttempts.map((item) => item.attemptId), adjacentFragmentGroups,
      structuredModelResponse, judgment: null, shouldSurface: false, latencyMs: Date.now() - started, errors, cacheHit: false };
    await this.store.put(failed); return failed;
  }
}

function compact(summary: CompactAttemptSummary): CompactAttemptSummary {
  return { ...summary, actionsTaken: summary.actionsTaken?.slice(0, 8) ?? [], importantFilesOrComponents: summary.importantFilesOrComponents?.slice(0, 8) ?? [],
    observedEvidence: summary.observedEvidence?.slice(0, 8) ?? [], uncertaintyAndCaveats: summary.uncertaintyAndCaveats?.slice(0, 4) ?? [] };
}
function fragmentContext(attempts: CompactAttemptSummary[]): string[][] {
  const groups: string[][] = [];
  for (const attempt of attempts) {
    const prior = groups.at(-1); const previous = attempts.find((item) => item.attemptId === prior?.at(-1));
    if (prior && previous && normalizedProblem(previous) === normalizedProblem(attempt)) prior.push(attempt.attemptId);
    else groups.push([attempt.attemptId]);
  }
  return groups.filter((group) => group.length > 1);
}
const normalizedProblem = (attempt: CompactAttemptSummary) => (attempt.problemBeingAddressed ?? "").toLowerCase().replace(/\s+/g, " ").trim();

function parseJudgment(value: unknown, priorIds: string[], currentId: string): RepeatJudgment {
  if (!value || typeof value !== "object") throw new Error("Structured response is not an object");
  const item = value as Record<string, unknown>; const classification = item.classification;
  if (classification !== "repeat" && classification !== "different" && classification !== "partial") throw new Error("Invalid classification");
  if (typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1) throw new Error("Invalid confidence");
  if (typeof item.plainEnglishExplanation !== "string" || item.plainEnglishExplanation.length > 500) throw new Error("Invalid plain-English explanation");
  const priorAttemptIds = strings(item.priorAttemptIds).filter((id) => priorIds.includes(id));
  const evidence = Array.isArray(item.evidence) ? item.evidence.flatMap((entry) => {
    const e = entry as Record<string, unknown>; return typeof e?.attemptId === "string" && [...priorIds, currentId].includes(e.attemptId) && typeof e.reason === "string"
      ? [{ attemptId: e.attemptId, reason: e.reason }] : [];
  }) : [];
  return { classification, confidence: item.confidence, plainEnglishExplanation: item.plainEnglishExplanation,
    repeatedStrategy: nullable(item.repeatedStrategy), genuinelyNewStrategy: nullable(item.genuinelyNewStrategy), priorAttemptIds,
    evidence, unresolvedIssue: nullable(item.unresolvedIssue), suggestedDifferentAngle: nullable(item.suggestedDifferentAngle) };
}
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const nullable = (value: unknown) => typeof value === "string" ? value : null;
function estimateCost(usage: { inputTokens?: number; outputTokens?: number } | undefined, options: ReasoningEngineOptions): number | undefined {
  if (!usage || options.inputCostPerMillionTokens === undefined || options.outputCostPerMillionTokens === undefined) return undefined;
  return ((usage.inputTokens ?? 0) * options.inputCostPerMillionTokens + (usage.outputTokens ?? 0) * options.outputCostPerMillionTokens) / 1_000_000;
}
