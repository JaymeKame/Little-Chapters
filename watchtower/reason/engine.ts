import { createHash } from "node:crypto";
import type { AttemptSummary } from "../schema.ts";
import { MemoryComparisonCache, type ComparisonCache } from "./cache.ts";
import { buildComparisonContext } from "./context.ts";
import { shouldSurface } from "./policy.ts";
import { REPEAT_REASONING_PROMPT_VERSION, REPEAT_REASONING_SYSTEM_PROMPT } from "./prompt.ts";
import type { ReasoningProvider, ReasoningResult, ReasoningTrace, Sensitivity } from "./types.ts";
import { parseJudgment } from "./validate.ts";

type EngineOptions = { provider: ReasoningProvider; cache?: ComparisonCache; timeoutMs?: number };

export class RepeatReasoningEngine {
  private readonly cache: ComparisonCache;
  private readonly options: EngineOptions;
  constructor(options: EngineOptions) { this.options = options; this.cache = options.cache ?? new MemoryComparisonCache(); }

  async compare(history: AttemptSummary[], current: AttemptSummary, sensitivity: Sensitivity = "balanced"): Promise<ReasoningResult> {
    const started = performance.now();
    const context = buildComparisonContext(history, current);
    const comparisonId = createHash("sha256").update(JSON.stringify({ version: REPEAT_REASONING_PROMPT_VERSION, model: this.options.provider.model, context })).digest("hex");
    const base: ReasoningTrace = { comparisonId, promptVersion: REPEAT_REASONING_PROMPT_VERSION, model: this.options.provider.model,
      context, consideredPriorAttemptIds: context.priorAttempts.map((item) => item.attemptId), sensitivity, shouldSurface: false,
      cached: false, latencyMs: 0, errors: [] };
    if (!context.priorAttempts.length) return { status: "skipped", reason: "No prior failed or unresolved attempts to compare", trace: { ...base, latencyMs: performance.now() - started } };
    const prior = await this.cache.get(comparisonId);
    if (prior?.judgment) {
      const trace = { ...prior, sensitivity, shouldSurface: shouldSurface(prior.judgment, sensitivity), cached: true, latencyMs: performance.now() - started };
      return { status: "judged", judgment: prior.judgment, trace };
    }
    const errors: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
      try {
        const response = await this.options.provider.judge(REPEAT_REASONING_SYSTEM_PROMPT, { promptVersion: REPEAT_REASONING_PROMPT_VERSION, ...context }, controller.signal);
        const judgment = parseJudgment(response.value, new Set(context.priorAttempts.map((item) => item.attemptId)));
        const judgmentId = createHash("sha256").update(`${comparisonId}:${JSON.stringify(judgment)}`).digest("hex");
        const trace: ReasoningTrace = { ...base, judgmentId, structuredModelResponse: response.value, judgment,
          shouldSurface: shouldSurface(judgment, sensitivity), latencyMs: performance.now() - started,
          tokenUsage: response.usage, estimatedApiCostUsd: response.estimatedCostUsd, errors };
        await this.cache.set(comparisonId, trace);
        return { status: "judged", judgment, trace };
      } catch (error) {
        errors.push(`${attempt === 0 ? "initial" : "retry"}: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof DOMException && error.name === "AbortError") break;
      } finally { clearTimeout(timer); }
    }
    return { status: "unavailable", reason: "Reasoning provider unavailable or returned invalid output", trace: { ...base, latencyMs: performance.now() - started, errors } };
  }
}
