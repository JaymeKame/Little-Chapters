import { createHash } from "node:crypto";
import type { AttemptSummary } from "../schema.ts";
import { buildReasoningInput, REPEAT_REASONING_PROMPT_VERSION, REPEAT_REASONING_SYSTEM_PROMPT } from "./prompt.ts";
import { shouldSurface } from "./policy.ts";
import { MemoryReasoningStore, type ReasoningStore } from "./store.ts";
import type { ComparisonTrace, ReasoningDecision, ReasoningProvider, RepeatJudgment, Sensitivity } from "./types.ts";

function parseJudgment(text: string, allowedIds: Set<string>): RepeatJudgment {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const value = JSON.parse(cleaned) as Partial<RepeatJudgment>;
  if (!(["repeat", "different", "partial"] as unknown[]).includes(value.classification) ||
      typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1 ||
      typeof value.plainEnglishExplanation !== "string" || value.plainEnglishExplanation.length > 500 ||
      !Array.isArray(value.priorAttemptIds) || !Array.isArray(value.evidence)) throw new Error("Malformed reasoning judgment");
  if (!value.priorAttemptIds.every((id) => typeof id === "string" && allowedIds.has(id))) throw new Error("Judgment cited an unknown prior attempt");
  if (!value.evidence.every((item) => item && typeof item.attemptId === "string" && allowedIds.has(item.attemptId) && typeof item.reason === "string"))
    throw new Error("Judgment evidence is invalid");
  for (const key of ["repeatedStrategy", "genuinelyNewStrategy", "unresolvedIssue", "suggestedDifferentAngle"] as const)
    if (value[key] !== null && typeof value[key] !== "string") throw new Error(`Judgment ${key} is invalid`);
  return value as RepeatJudgment;
}

function relevantPrior(history: AttemptSummary[], current: AttemptSummary): AttemptSummary[] {
  return history.filter((item) => item.attemptId !== current.attemptId && item.inferredOutcome !== "success").slice(-6);
}

export class RepeatReasoningEngine {
  private readonly provider: ReasoningProvider;
  private readonly store: ReasoningStore;
  private readonly timeoutMs: number;
  constructor(provider: ReasoningProvider, store: ReasoningStore = new MemoryReasoningStore(), timeoutMs = 20_000) {
    this.provider = provider; this.store = store; this.timeoutMs = timeoutMs;
  }

  async judge(history: AttemptSummary[], current: AttemptSummary, sensitivity: Sensitivity = "balanced"): Promise<ReasoningDecision> {
    const prior = relevantPrior(history, current);
    const input = buildReasoningInput(prior, current);
    const comparisonId = createHash("sha256").update(JSON.stringify({ version: REPEAT_REASONING_PROMPT_VERSION, model: this.provider.model, input })).digest("hex");
    const cached = await this.store.get(comparisonId);
    if (cached?.judgment) {
      const surface = shouldSurface(cached.judgment, sensitivity);
      const trace = { ...cached, sensitivity, shouldSurface: surface, cacheHit: true };
      return { judgment: cached.judgment, shouldSurface: surface, comparisonId, trace };
    }
    const started = performance.now(); const errors: string[] = []; let response;
    let judgment: RepeatJudgment | null = null; let structured: unknown;
    if (!prior.length) errors.push("No prior failed or unresolved attempts were available");
    else for (let attempt = 0; attempt < 2 && !judgment; attempt++) {
      try {
        response = await this.provider.complete(REPEAT_REASONING_SYSTEM_PROMPT, input, AbortSignal.timeout(this.timeoutMs));
        try { structured = JSON.parse(response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); } catch { structured = response.text; }
        judgment = parseJudgment(response.text, new Set(prior.map((item) => item.attemptId)));
      } catch (error) { errors.push(`${attempt ? "retry" : "initial"}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    const surface = judgment ? shouldSurface(judgment, sensitivity) : false;
    const trace: ComparisonTrace = { comparisonId, createdAt: new Date().toISOString(), promptVersion: REPEAT_REASONING_PROMPT_VERSION,
      model: response?.model ?? this.provider.model, suppliedSummaries: [...prior, current], consideredPriorAttemptIds: prior.map((item) => item.attemptId),
      currentAttemptId: current.attemptId, structuredModelResponse: structured, judgment, sensitivity, shouldSurface: surface,
      latencyMs: Math.round(performance.now() - started), tokenUsage: response?.tokenUsage, estimatedCostUsd: response?.estimatedCostUsd,
      errors, cacheHit: false };
    await this.store.put(trace);
    return { judgment, shouldSurface: surface, comparisonId, trace };
  }
}
