import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AttemptSummary } from "../schema.ts";
import { REPEAT_REASONING_PROMPT_VERSION, REPEAT_REASONING_SYSTEM_PROMPT } from "./prompt.ts";
import type { ComparisonDebugRecord, ReasoningPromptInput, ReasoningProvider, ReasoningResult, Sensitivity } from "./schema.ts";
import { DEFAULT_SENSITIVITY, shouldSurface } from "./sensitivity.ts";
import { parseRepeatJudgment } from "./validation.ts";

export type ReasoningEngineOptions = { sensitivity?: Sensitivity; timeoutMs?: number; maxPriorAttempts?: number; debugJsonlPath?: string };

function compact(summary: AttemptSummary): AttemptSummary {
  const trim = (values: unknown): string[] => Array.isArray(values)
    ? values.filter((value): value is string => typeof value === "string").slice(0, 8).map((value) => value.slice(0, 500)) : [];
  const short = (value: unknown, length = 800): string => typeof value === "string" ? value.slice(0, length) : "";
  return { attemptId: short(summary.attemptId, 200), problemBeingAddressed: short(summary.problemBeingAddressed),
    intendedApproach: short(summary.intendedApproach), actionsTaken: trim(summary.actionsTaken),
    importantFilesOrComponents: trim(summary.importantFilesOrComponents), observedEvidence: trim(summary.observedEvidence),
    inferredOutcome: ["success", "failure", "unresolved"].includes(summary.inferredOutcome) ? summary.inferredOutcome : "unresolved",
    failureReason: typeof summary.failureReason === "string" ? short(summary.failureReason) : undefined,
    appearsToHaveAddressed: short(summary.appearsToHaveAddressed), mayRemainUnresolved: short(summary.mayRemainUnresolved),
    uncertaintyAndCaveats: trim(summary.uncertaintyAndCaveats) };
}

function contextGroups(prior: AttemptSummary[]): string[][] {
  const groups: string[][] = [];
  for (const attempt of prior) {
    const previous = groups.at(-1);
    const preceding = prior[prior.indexOf(attempt) - 1];
    const sameProblem = preceding && (attempt.problemBeingAddressed ?? "").trim().toLowerCase() === (preceding.problemBeingAddressed ?? "").trim().toLowerCase();
    if (previous && sameProblem) previous.push(attempt.attemptId); else groups.push([attempt.attemptId]);
  }
  return groups;
}

function identity(input: ReasoningPromptInput, model: string): string {
  return createHash("sha256").update(JSON.stringify({ version: REPEAT_REASONING_PROMPT_VERSION, model, input })).digest("hex");
}

export class RepeatReasoningEngine {
  private readonly cache = new Map<string, ReasoningResult>();
  private readonly provider: ReasoningProvider;
  private readonly options: ReasoningEngineOptions;
  constructor(provider: ReasoningProvider, options: ReasoningEngineOptions = {}) { this.provider = provider; this.options = options; }

  async compare(history: AttemptSummary[], current: AttemptSummary): Promise<ReasoningResult> {
    const sensitivity = this.options.sensitivity ?? DEFAULT_SENSITIVITY;
    const eligible = history.filter((attempt) => attempt.inferredOutcome !== "success").slice(-(this.options.maxPriorAttempts ?? 6)).map(compact);
    const input: ReasoningPromptInput = { priorAttempts: eligible, currentAttempt: compact(current), adjacentContextGroups: contextGroups(eligible) };
    const comparisonId = identity(input, this.provider.model);
    const cached = this.cache.get(comparisonId);
    if (cached) return { ...cached, debug: { ...cached.debug, cacheHit: true } };
    const started = performance.now();
    const debug: ComparisonDebugRecord = { comparisonId, createdAt: new Date().toISOString(), promptVersion: REPEAT_REASONING_PROMPT_VERSION,
      model: this.provider.model, suppliedSummaries: input, consideredPriorAttemptIds: eligible.map((a) => a.attemptId),
      adjacentContextGroups: input.adjacentContextGroups, sensitivity, shouldSurface: false, latencyMs: 0, errors: [], cacheHit: false };
    let result: ReasoningResult;
    if (!eligible.length) result = { status: "insufficient_history", comparisonId, shouldSurface: false, debug };
    else {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
      try {
        const response = await this.provider.judge(REPEAT_REASONING_SYSTEM_PROMPT, input, controller.signal);
        const judgment = parseRepeatJudgment(response.structuredResponse, new Set(eligible.map((a) => a.attemptId)));
        debug.structuredModelResponse = response.structuredResponse; debug.parsedJudgment = judgment;
        debug.usage = response.usage; debug.estimatedCostUsd = response.estimatedCostUsd;
        debug.shouldSurface = shouldSurface(judgment, sensitivity);
        result = { status: "judged", comparisonId, judgment, shouldSurface: debug.shouldSurface, debug };
      } catch (error) {
        debug.errors.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
        result = { status: "provider_error", comparisonId, shouldSurface: false, debug };
      } finally { clearTimeout(timer); }
    }
    debug.latencyMs = Math.round((performance.now() - started) * 100) / 100;
    this.cache.set(comparisonId, result);
    if (this.options.debugJsonlPath) {
      try { await mkdir(dirname(this.options.debugJsonlPath), { recursive: true }); await appendFile(this.options.debugJsonlPath, `${JSON.stringify(debug)}\n`, { mode: 0o600 }); }
      catch { /* Debug persistence must never interrupt an observed coding session. */ }
    }
    return result;
  }
}
