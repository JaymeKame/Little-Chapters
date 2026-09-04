import { createHash } from "node:crypto";
import type { AttemptSummary } from "../schema.ts";
import { buildReasoningInput, REPEAT_REASONING_PROMPT_VERSION, REPEAT_REASONING_SYSTEM_PROMPT } from "./prompt.ts";
import { shouldSurface } from "./sensitivity.ts";
import type { ContextGroup, ReasoningProvider, ReasoningResult, ReasoningTrace, RepeatJudgment, Sensitivity } from "./types.ts";
import type { ReasoningCache } from "./cache.ts";

type EngineOptions = { provider: ReasoningProvider; cache: ReasoningCache; timeoutMs?: number; maxPriorAttempts?: number };
type CompareOptions = { sensitivity?: Sensitivity };

const normalizeProblem = (value: unknown) => typeof value === "string"
  ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : "";

function groupFragments(prior: Array<Partial<AttemptSummary>>): ContextGroup[] {
  const groups: ContextGroup[] = [];
  for (const summary of prior) {
    const problem = normalizeProblem(summary.problemBeingAddressed);
    const last = groups.at(-1);
    const previous = prior.find((item) => item.attemptId === last?.attemptIds.at(-1));
    const previousProblem = normalizeProblem(previous?.problemBeingAddressed);
    const generic = (value: string) => !value || value.includes("not explicitly stated") || value.includes("unknown");
    if (last && (problem === previousProblem || generic(problem) || generic(previousProblem))) {
      last.attemptIds.push(summary.attemptId ?? "missing-attempt-id");
      last.reason = "Adjacent summaries share a problem label or one has no explicit problem; they may be fragments of one strategy.";
    } else groups.push({ groupId: `context-${groups.length + 1}`, reason: "Separate adjacent context pending semantic review by the model.",
      attemptIds: [summary.attemptId ?? "missing-attempt-id"] });
  }
  return groups;
}

function parseJudgment(text: string, validPriorIds: Set<string>): RepeatJudgment {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const value = JSON.parse(cleaned) as Record<string, unknown>;
  if (!(["repeat", "different", "partial"] as unknown[]).includes(value.classification)) throw new Error("Invalid classification");
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) throw new Error("Invalid confidence");
  if (typeof value.plainEnglishExplanation !== "string" || !value.plainEnglishExplanation.trim()) throw new Error("Missing explanation");
  const nullable = (key: string) => value[key] === null || typeof value[key] === "string" ? value[key] as string | null : null;
  const priorAttemptIds = Array.isArray(value.priorAttemptIds)
    ? value.priorAttemptIds.filter((id): id is string => typeof id === "string" && validPriorIds.has(id)) : [];
  const evidence = Array.isArray(value.evidence) ? value.evidence.flatMap((item) => {
    if (typeof item !== "object" || !item) return [];
    const record = item as Record<string, unknown>;
    return typeof record.attemptId === "string" && validPriorIds.has(record.attemptId) && typeof record.reason === "string"
      ? [{ attemptId: record.attemptId, reason: record.reason }] : [];
  }) : [];
  return { classification: value.classification as RepeatJudgment["classification"], confidence: value.confidence,
    plainEnglishExplanation: value.plainEnglishExplanation.trim(), repeatedStrategy: nullable("repeatedStrategy"),
    genuinelyNewStrategy: nullable("genuinelyNewStrategy"), priorAttemptIds, evidence,
    unresolvedIssue: nullable("unresolvedIssue"), suggestedDifferentAngle: nullable("suggestedDifferentAngle") };
}

export class RepeatReasoningEngine {
  private readonly options: EngineOptions;
  private readonly timeoutMs: number;
  private readonly maxPriorAttempts: number;
  constructor(options: EngineOptions) {
    this.options = options;
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.maxPriorAttempts = options.maxPriorAttempts ?? 6;
  }

  async compare(history: Array<Partial<AttemptSummary>>, current: Partial<AttemptSummary>, options: CompareOptions = {}): Promise<ReasoningResult> {
    const sensitivity = options.sensitivity ?? "balanced";
    const prior = history.filter((item) => item.inferredOutcome !== "success").slice(-this.maxPriorAttempts);
    const groups = groupFragments(prior);
    const input = buildReasoningInput(prior, current, groups);
    const comparisonId = createHash("sha256").update(`${REPEAT_REASONING_PROMPT_VERSION}\0${this.options.provider.model}\0${input}`).digest("hex");
    const base = { comparisonId, createdAt: new Date().toISOString(), promptVersion: REPEAT_REASONING_PROMPT_VERSION,
      model: this.options.provider.model, sensitivity, suppliedSummaries: [...prior, current],
      consideredPriorAttemptIds: prior.flatMap((item) => item.attemptId ? [item.attemptId] : []), contextGroups: groups };
    const cached = await this.options.cache.get(comparisonId);
    if (cached?.parsedJudgment) {
      const surface = shouldSurface(cached.parsedJudgment, sensitivity);
      const trace = { ...cached, sensitivity, shouldSurface: surface, cacheHit: true };
      return { status: "evaluated", judgment: trace.parsedJudgment, shouldSurface: surface, duplicate: true, trace };
    }
    if (!prior.length) {
      const trace: ReasoningTrace = { ...base, structuredModelResponse: null, parsedJudgment: null, shouldSurface: false,
        cacheHit: false, latencyMs: 0, usage: null, errors: ["No prior failed or unresolved attempt was available."] };
      return { status: "insufficient_history", judgment: null, shouldSurface: false, duplicate: false, trace };
    }
    const started = Date.now(); const errors: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.options.provider.complete(REPEAT_REASONING_SYSTEM_PROMPT,
          attempt === 0 ? input : `${input}\nThe prior response was invalid JSON. Return only the required JSON object.`, controller.signal);
        const judgment = parseJudgment(response.text, new Set(base.consideredPriorAttemptIds));
        const surface = shouldSurface(judgment, sensitivity);
        const trace: ReasoningTrace = { ...base, model: response.model, structuredModelResponse: response.structuredResponse ?? response.text,
          parsedJudgment: judgment, shouldSurface: surface, cacheHit: false, latencyMs: Date.now() - started,
          usage: response.usage ?? null, errors };
        await this.options.cache.put(trace);
        return { status: "evaluated", judgment, shouldSurface: surface, duplicate: false, trace };
      } catch (error) { errors.push(`${attempt === 0 ? "initial" : "retry"}: ${String(error)}`); }
      finally { clearTimeout(timeout); }
    }
    const trace: ReasoningTrace = { ...base, structuredModelResponse: null, parsedJudgment: null, shouldSurface: false,
      cacheHit: false, latencyMs: Date.now() - started, usage: null, errors };
    await this.options.cache.put(trace).catch(() => undefined);
    return { status: "failed", judgment: null, shouldSurface: false, duplicate: false, trace };
  }
}
