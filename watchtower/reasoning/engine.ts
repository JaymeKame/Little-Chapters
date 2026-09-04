import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AttemptSummary } from "../schema.ts";
import { MemoryJudgmentCache, type JudgmentCache } from "./cache.ts";
import { shouldSurface } from "./decision.ts";
import { buildReasoningInput, REPEAT_REASONING_PROMPT_VERSION, REPEAT_REASONING_SYSTEM_PROMPT } from "./prompt.ts";
import type { ComparisonTrace, ReasoningProvider, ReasoningResult, RepeatJudgment, Sensitivity } from "./types.ts";

export type ReasoningEngineOptions = {
  sensitivity?: Sensitivity;
  timeoutMs?: number;
  maxPriorAttempts?: number;
  cache?: JudgmentCache;
  tracePath?: string;
  inputCostPerMillionTokens?: number;
  outputCostPerMillionTokens?: number;
};

function comparisonId(prior: AttemptSummary[], current: AttemptSummary): string {
  return createHash("sha256").update(JSON.stringify({ prompt: REPEAT_REASONING_PROMPT_VERSION, prior, current })).digest("hex");
}

function parseJudgment(text: string, allowedIds: Set<string>): RepeatJudgment {
  const start = text.indexOf("{"); const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Model response did not contain a JSON object");
  const value = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  if (!(["repeat", "different", "partial"] as unknown[]).includes(value.classification)) throw new Error("Invalid classification");
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) throw new Error("Confidence must be between 0 and 1");
  if (typeof value.plainEnglishExplanation !== "string" || !value.plainEnglishExplanation.trim()) throw new Error("Missing plain-English explanation");
  const nullable = (name: string) => value[name] === null || typeof value[name] === "string" ? value[name] as string | null : (() => { throw new Error(`Invalid ${name}`); })();
  const ids = Array.isArray(value.priorAttemptIds) ? value.priorAttemptIds.filter((id): id is string => typeof id === "string" && allowedIds.has(id)) : [];
  const evidence = Array.isArray(value.evidence) ? value.evidence.flatMap((item) => {
    const record = typeof item === "object" && item ? item as Record<string, unknown> : {};
    return typeof record.attemptId === "string" && allowedIds.has(record.attemptId) && typeof record.reason === "string"
      ? [{ attemptId: record.attemptId, reason: record.reason }] : [];
  }) : [];
  return { classification: value.classification as RepeatJudgment["classification"], confidence: value.confidence,
    plainEnglishExplanation: value.plainEnglishExplanation.trim(), repeatedStrategy: nullable("repeatedStrategy"),
    genuinelyNewStrategy: nullable("genuinelyNewStrategy"), priorAttemptIds: ids, evidence,
    unresolvedIssue: nullable("unresolvedIssue"), suggestedDifferentAngle: nullable("suggestedDifferentAngle") };
}

async function recordTrace(path: string | undefined, trace: ComparisonTrace) {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await appendFile(path, `${JSON.stringify(trace)}\n`, { encoding: "utf8", mode: 0o600 });
}

export class RepeatReasoningEngine {
  private readonly cache: JudgmentCache;
  private readonly provider: ReasoningProvider;
  private readonly options: ReasoningEngineOptions;
  constructor(provider: ReasoningProvider, options: ReasoningEngineOptions = {}) {
    this.provider = provider; this.options = options;
    this.cache = options.cache ?? new MemoryJudgmentCache();
  }

  async compare(history: AttemptSummary[], current: AttemptSummary): Promise<ReasoningResult> {
    const started = performance.now();
    const sensitivity = this.options.sensitivity ?? "balanced";
    const eligible = history.filter((item) => item.inferredOutcome !== "success").slice(-(this.options.maxPriorAttempts ?? 6));
    const id = comparisonId(eligible, current);
    const cached = await this.cache.get(id);
    if (cached) {
      const surfaced = shouldSurface(cached.judgment, sensitivity);
      const trace = { ...cached.trace, sensitivity, shouldSurface: surfaced, cacheHit: true, latencyMs: performance.now() - started };
      await recordTrace(this.options.tracePath, trace);
      return { comparisonId: id, judgment: cached.judgment, shouldSurface: surfaced, duplicate: true, trace };
    }
    const trace: ComparisonTrace = { comparisonId: id, createdAt: new Date().toISOString(), promptVersion: REPEAT_REASONING_PROMPT_VERSION,
      suppliedSummaries: { prior: eligible, current }, consideredPriorAttemptIds: eligible.map((item) => item.attemptId),
      fragmentHandling: "Adjacent summaries are supplied in order and explicitly treated as possible fragments of one strategy.",
      sensitivity, shouldSurface: false, latencyMs: 0, cacheHit: false, parsingAndRetryErrors: [] };
    if (!eligible.length) {
      trace.failure = "No prior failed or unresolved attempts were available"; trace.latencyMs = performance.now() - started;
      await recordTrace(this.options.tracePath, trace);
      return { comparisonId: id, judgment: null, shouldSurface: false, duplicate: false, trace };
    }
    const input = buildReasoningInput(eligible, current);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.provider.complete({ system: REPEAT_REASONING_SYSTEM_PROMPT,
          input: attempt ? `${input}\nYour previous response was invalid. Return only the required JSON object.` : input,
          timeoutMs: this.options.timeoutMs ?? 8_000 });
        trace.model = response.model; trace.structuredModelResponse = response.text;
        const judgment = parseJudgment(response.text, new Set(eligible.map((item) => item.attemptId)));
        const usage = response.usage;
        const estimatedCostUsd = usage && this.options.inputCostPerMillionTokens !== undefined && this.options.outputCostPerMillionTokens !== undefined
          ? ((usage.inputTokens ?? 0) * this.options.inputCostPerMillionTokens + (usage.outputTokens ?? 0) * this.options.outputCostPerMillionTokens) / 1_000_000 : undefined;
        trace.usage = { ...usage, estimatedCostUsd }; trace.parsedJudgment = judgment;
        trace.judgmentId = createHash("sha256").update(`${id}:${JSON.stringify(judgment)}`).digest("hex");
        trace.shouldSurface = shouldSurface(judgment, sensitivity); trace.latencyMs = performance.now() - started;
        await this.cache.put(id, { judgment, trace }); await recordTrace(this.options.tracePath, trace);
        return { comparisonId: id, judgment, shouldSurface: trace.shouldSurface, duplicate: false, trace };
      } catch (error) { trace.parsingAndRetryErrors.push(String(error)); }
    }
    trace.failure = trace.parsingAndRetryErrors.at(-1); trace.latencyMs = performance.now() - started;
    await recordTrace(this.options.tracePath, trace);
    return { comparisonId: id, judgment: null, shouldSurface: false, duplicate: false, trace };
  }
}
