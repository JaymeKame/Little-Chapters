import { createHash } from "node:crypto";
import type { AttemptSummary } from "../schema.ts";
import { buildComparisonInput, REPEAT_REASONING_PROMPT_VERSION, REPEAT_REASONING_SYSTEM_PROMPT } from "./prompt.ts";
import { shouldSurface } from "./decision.ts";
import type { ComparisonTrace, ReasoningProvider, RepeatJudgment, Sensitivity } from "./types.ts";
import type { ReasoningCache } from "./cache.ts";

export type ReasoningOptions = { sensitivity?: Sensitivity; timeoutMs?: number; maxPriorAttempts?: number;
  inputCostPerMillionTokens?: number; outputCostPerMillionTokens?: number };

function parseJudgment(text: string): RepeatJudgment {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const value = JSON.parse(cleaned) as Record<string, unknown>;
  if (!["repeat", "different", "partial"].includes(String(value.classification))) throw new Error("Invalid classification");
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) throw new Error("Invalid confidence");
  if (typeof value.plainEnglishExplanation !== "string" || !value.plainEnglishExplanation.trim()) throw new Error("Missing explanation");
  const strings = (input: unknown) => Array.isArray(input) && input.every((item) => typeof item === "string") ? input as string[] : [];
  const nullable = (input: unknown) => typeof input === "string" ? input : null;
  const evidence = Array.isArray(value.evidence) ? value.evidence.flatMap((item) => {
    const entry = item as Record<string, unknown>;
    return typeof entry.attemptId === "string" && typeof entry.reason === "string" ? [{ attemptId: entry.attemptId, reason: entry.reason }] : [];
  }) : [];
  return { classification: value.classification as RepeatJudgment["classification"], confidence: value.confidence,
    plainEnglishExplanation: value.plainEnglishExplanation, repeatedStrategy: nullable(value.repeatedStrategy),
    genuinelyNewStrategy: nullable(value.genuinelyNewStrategy), priorAttemptIds: strings(value.priorAttemptIds),
    evidence, unresolvedIssue: nullable(value.unresolvedIssue), suggestedDifferentAngle: nullable(value.suggestedDifferentAngle) };
}

function groupFragments(prior: AttemptSummary[]) {
  const groups: Array<{ groupId: string; attemptIds: string[]; reason: string }> = [];
  for (const item of prior) {
    const key = String(item.problemBeingAddressed ?? "").trim().toLowerCase(); const last = groups.at(-1);
    if (last && (last as typeof last & { key?: string }).key === key) last.attemptIds.push(item.attemptId);
    else groups.push(Object.assign({ groupId: `context-${groups.length + 1}`, attemptIds: [item.attemptId],
      reason: "Adjacent summaries share the same stated problem and may be fragments of one strategy." }, { key }));
  }
  return groups.map(({ groupId, attemptIds, reason }) => ({ groupId, attemptIds, reason }));
}

function estimateCost(usage: { inputTokens?: number; outputTokens?: number } | undefined, options: ReasoningOptions) {
  if (!usage || options.inputCostPerMillionTokens === undefined || options.outputCostPerMillionTokens === undefined) return null;
  return ((usage.inputTokens ?? 0) * options.inputCostPerMillionTokens + (usage.outputTokens ?? 0) * options.outputCostPerMillionTokens) / 1_000_000;
}

export async function reasonAboutRepeat(history: AttemptSummary[], current: AttemptSummary, provider: ReasoningProvider,
  cache: ReasoningCache, options: ReasoningOptions = {}): Promise<ComparisonTrace> {
  const started = Date.now(); const sensitivity = options.sensitivity ?? "balanced";
  const prior = history.filter((attempt) => attempt.inferredOutcome !== "success").slice(-(options.maxPriorAttempts ?? 6));
  const groups = groupFragments(prior);
  const input = buildComparisonInput(prior, current, groups);
  const comparisonId = createHash("sha256").update(JSON.stringify({ version: REPEAT_REASONING_PROMPT_VERSION,
    provider: provider.name, model: provider.model, input })).digest("hex").slice(0, 32);
  const cached = await cache.get(comparisonId);
  if (cached) return { ...cached, sensitivity, shouldSurface: shouldSurface(cached.judgment, sensitivity),
    latencyMs: Date.now() - started, cacheHit: true };
  const common = { comparisonId, promptVersion: REPEAT_REASONING_PROMPT_VERSION, provider: provider.name,
    model: provider.model, summariesSupplied: { prior, current }, consideredPriorAttemptIds: prior.map((item) => item.attemptId),
    contextGroups: groups, sensitivity, createdAt: new Date().toISOString() };
  if (!prior.length) return { ...common, status: "insufficient_history", structuredModelResponse: null, judgment: null,
    shouldSurface: false, latencyMs: Date.now() - started, tokenUsage: null, estimatedApiCostUsd: null,
    errors: ["No prior failed or unresolved attempt was available."], cacheHit: false };
  const errors: string[] = []; let structuredModelResponse: unknown = null; let usage: { inputTokens?: number; outputTokens?: number } | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);
    try {
      const response = await provider.complete(REPEAT_REASONING_SYSTEM_PROMPT,
        JSON.stringify({ ...input, retryInstruction: attempt ? "The prior response was invalid. Return only the required JSON object." : undefined }), controller.signal);
      structuredModelResponse = response.raw; usage = response.usage;
      const judgment = parseJudgment(response.text);
      const trace: ComparisonTrace = { ...common, status: "judged", structuredModelResponse, judgment,
        shouldSurface: shouldSurface(judgment, sensitivity), latencyMs: Date.now() - started,
        tokenUsage: usage ?? null, estimatedApiCostUsd: estimateCost(usage, options), errors, cacheHit: false };
      await cache.set(comparisonId, trace); return trace;
    } catch (error) { errors.push(`${attempt ? "retry" : "initial"}: ${String(error)}`); }
    finally { clearTimeout(timer); }
  }
  return { ...common, status: "failed", structuredModelResponse, judgment: null, shouldSurface: false,
    latencyMs: Date.now() - started, tokenUsage: usage ?? null, estimatedApiCostUsd: estimateCost(usage, options), errors, cacheHit: false };
}
