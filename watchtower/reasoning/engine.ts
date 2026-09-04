import { createHash } from "node:crypto";
import type { AttemptSummary } from "../schema.ts";
import { MemoryReasoningCache, type ReasoningCache } from "./cache.ts";
import { buildReasoningInput, REPEAT_REASONING_PROMPT_VERSION, REPEAT_REASONING_SYSTEM_PROMPT } from "./prompt.ts";
import { DEFAULT_SENSITIVITY, shouldSurface } from "./sensitivity.ts";
import type { AttemptContextGroup, CompactAttemptSummary, ComparisonDebugRecord, ComparisonResult, ReasoningProvider, Sensitivity } from "./types.ts";
import { parseJudgment } from "./validation.ts";

export type RepeatReasonerOptions = {
  provider: ReasoningProvider;
  model: string;
  sensitivity?: Sensitivity;
  cache?: ReasoningCache;
  maxPriorAttempts?: number;
  maxOutputTokens?: number;
  inputCostPerMillionTokens?: number;
  outputCostPerMillionTokens?: number;
};

const normalizeProblem = (text?: string) => text?.toLowerCase().replace(/\s+/g, " ").trim() ?? "";
const compact = (summary: AttemptSummary): CompactAttemptSummary => ({
  attemptId: summary.attemptId, problemBeingAddressed: summary.problemBeingAddressed,
  intendedApproach: summary.intendedApproach, actionsTaken: summary.actionsTaken,
  importantFilesOrComponents: summary.importantFilesOrComponents, observedEvidence: summary.observedEvidence,
  inferredOutcome: summary.inferredOutcome, failureReason: summary.failureReason,
  appearsToHaveAddressed: summary.appearsToHaveAddressed, mayRemainUnresolved: summary.mayRemainUnresolved,
  uncertaintyAndCaveats: summary.uncertaintyAndCaveats,
});

export function groupAdjacentContext(summaries: CompactAttemptSummary[]): AttemptContextGroup[] {
  const groups: AttemptContextGroup[] = [];
  for (const summary of summaries) {
    const previous = groups.at(-1);
    const priorSummary = summaries.find((item) => item.attemptId === previous?.attemptIds.at(-1));
    const sameProblem = Boolean(previous && normalizeProblem(priorSummary?.problemBeingAddressed) &&
      normalizeProblem(priorSummary?.problemBeingAddressed) === normalizeProblem(summary.problemBeingAddressed));
    const fragment = Boolean(previous && (summary.intendedApproach === "No explicit approach statement observed" || !summary.intendedApproach));
    if (previous && (sameProblem || fragment)) {
      previous.attemptIds.push(summary.attemptId);
      previous.reason = sameProblem ? "adjacent_same_problem" : "adjacent_fragment_context";
    } else groups.push({ groupId: `context-${groups.length + 1}`, reason: "standalone_context", attemptIds: [summary.attemptId] });
  }
  return groups;
}

export class RepeatReasoner {
  private readonly cache: ReasoningCache;
  private readonly options: RepeatReasonerOptions;
  constructor(options: RepeatReasonerOptions) {
    this.options = options;
    this.cache = options.cache ?? new MemoryReasoningCache();
  }

  async compare(history: AttemptSummary[], current: AttemptSummary): Promise<ComparisonResult> {
    const sensitivity = this.options.sensitivity ?? DEFAULT_SENSITIVITY;
    const prior = history.filter((item) => item.attemptId !== current.attemptId && item.inferredOutcome !== "success")
      .slice(-(this.options.maxPriorAttempts ?? 8)).map(compact);
    const compactCurrent = compact(current);
    const contextGroups = groupAdjacentContext(prior);
    const identityInput = JSON.stringify({ version: REPEAT_REASONING_PROMPT_VERSION, model: this.options.model, prior, current: compactCurrent });
    const comparisonId = createHash("sha256").update(identityInput).digest("hex");
    const cached = await this.cache.get(comparisonId);
    if (cached) {
      const debug = { ...cached, cacheHit: true, shouldSurface: false };
      return { comparisonId, judgment: cached.judgment, shouldSurface: false, cached: true, debug };
    }

    const started = performance.now(); const errors: string[] = [];
    const input = buildReasoningInput(prior, compactCurrent, contextGroups);
    let structuredModelResponse: unknown = null; let judgment = null; let usage = null;
    try {
      const response = await this.options.provider.complete({ system: REPEAT_REASONING_SYSTEM_PROMPT, input,
        model: this.options.model, maxOutputTokens: this.options.maxOutputTokens ?? 900 }, new AbortController().signal);
      structuredModelResponse = response.raw ?? response.text; usage = response.usage ?? null;
      try { judgment = parseJudgment(response.text); } catch (error) { errors.push(`parse: ${String(error)}`); }
    } catch (error) { errors.push(`provider: ${String(error)}`); }
    const estimatedCostUsd = usage && (usage.inputTokens !== undefined || usage.outputTokens !== undefined)
      && (this.options.inputCostPerMillionTokens !== undefined || this.options.outputCostPerMillionTokens !== undefined)
      ? ((usage.inputTokens ?? 0) * (this.options.inputCostPerMillionTokens ?? 0) + (usage.outputTokens ?? 0) * (this.options.outputCostPerMillionTokens ?? 0)) / 1_000_000 : null;
    const surface = shouldSurface(judgment, sensitivity);
    const debug: ComparisonDebugRecord = { comparisonId, createdAt: new Date().toISOString(), promptVersion: REPEAT_REASONING_PROMPT_VERSION,
      model: this.options.model, provider: this.options.provider.name, summariesSupplied: { prior, current: compactCurrent },
      priorAttemptIdsConsidered: prior.map((item) => item.attemptId), contextGroups, structuredModelResponse,
      judgment, sensitivity, shouldSurface: surface, latencyMs: Math.round(performance.now() - started), usage,
      estimatedCostUsd, cacheHit: false, errors };
    await this.cache.set(comparisonId, debug);
    return { comparisonId, judgment, shouldSurface: surface, cached: false, debug };
  }
}
