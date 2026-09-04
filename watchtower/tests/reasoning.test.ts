import test from "node:test";
import assert from "node:assert/strict";
import type { AttemptSummary } from "../schema.ts";
import { MemoryReasoningCache } from "../reasoning/cache.ts";
import { reasonAboutRepeat } from "../reasoning/engine.ts";
import { shouldSurface } from "../reasoning/decision.ts";
import type { ModelResponse, ReasoningProvider, RepeatClassification, RepeatJudgment } from "../reasoning/types.ts";

function summary(attemptId: string, approach: string, outcome: AttemptSummary["inferredOutcome"] = "failure",
  files = ["validator.ts"], problem = "Generated payload fails validation"): AttemptSummary {
  return { attemptId, problemBeingAddressed: problem, intendedApproach: approach,
    actionsTaken: [approach], importantFilesOrComponents: files, observedEvidence: outcome === "success" ? ["tests pass"] : ["validation still fails"],
    inferredOutcome: outcome, failureReason: outcome === "failure" ? "Malformed output still rejected" : undefined,
    appearsToHaveAddressed: approach, mayRemainUnresolved: outcome === "success" ? "" : "Cause of malformed output",
    uncertaintyAndCaveats: [] };
}

const cases: Array<{ name: string; prior: AttemptSummary[]; current: AttemptSummary; classification: RepeatClassification; confidence: number }> = [
  { name: "A clear repeat", prior: [summary("a1", "Change validator formatting rules")],
    current: summary("a2", "Change another validator formatting rule", "unresolved"), classification: "repeat", confidence: .94 },
  { name: "B genuinely different", prior: [summary("b1", "Change validator formatting rules")],
    current: summary("b2", "Trace malformed payload upstream and repair generation logic", "unresolved", ["validator.ts", "generator.ts"]), classification: "different", confidence: .91 },
  { name: "C partial", prior: [summary("c1", "Increase provider retries", "failure", ["provider.ts"], "Provider request fails")],
    current: summary("c2", "Increase retries and inspect underlying provider response", "unresolved", ["provider.ts"], "Provider request fails"), classification: "partial", confidence: .86 },
  { name: "D superficial wording difference", prior: [summary("d1", "Relax the validator's accepted date format")],
    current: summary("d2", "Broaden permissible temporal string syntax", "unresolved"), classification: "repeat", confidence: .88 },
  { name: "E same files different strategy", prior: [summary("e1", "Relax validation rules")],
    current: summary("e2", "Repair payload construction before validation", "unresolved", ["validator.ts"]), classification: "different", confidence: .9 },
  { name: "F fragmented attempts", prior: [summary("f1", "Inspect validator rule"), summary("f2", "Apply validator formatting change")],
    current: summary("f3", "Apply a second validator formatting change", "unresolved"), classification: "repeat", confidence: .92 },
  { name: "G insufficient semantic evidence", prior: [summary("g1", "Try a fix", "unresolved", [], "Bug")],
    current: summary("g2", "Try another fix", "unresolved", [], "Bug"), classification: "partial", confidence: .31 },
];

class FixtureLlm implements ReasoningProvider {
  readonly name = "fixture-llm"; readonly model = "semantic-judge-test"; calls = 0;
  private expected: RepeatClassification; private confidence: number;
  constructor(expected: RepeatClassification, confidence: number) { this.expected = expected; this.confidence = confidence; }
  async complete(_system: string, input: string): Promise<ModelResponse> {
    this.calls++; const parsed = JSON.parse(input) as { newestAttempt: AttemptSummary; priorFailedOrUnresolvedAttempts: AttemptSummary[] };
    assert.ok(parsed.newestAttempt.intendedApproach);
    assert.ok(parsed.priorFailedOrUnresolvedAttempts.every((attempt) => attempt.inferredOutcome !== "success"));
    const judgment: RepeatJudgment = { classification: this.expected, confidence: this.confidence,
      plainEnglishExplanation: this.confidence < .5 ? "There is not enough detail to tell whether this is a new approach." : "The strategy relationship is clear from what Claude tried and what remained broken.",
      repeatedStrategy: this.expected === "different" ? null : parsed.newestAttempt.intendedApproach,
      genuinelyNewStrategy: this.expected === "repeat" ? null : parsed.newestAttempt.intendedApproach,
      priorAttemptIds: parsed.priorFailedOrUnresolvedAttempts.map((attempt) => attempt.attemptId),
      evidence: parsed.priorFailedOrUnresolvedAttempts.map((attempt) => ({ attemptId: attempt.attemptId, reason: attempt.intendedApproach })),
      unresolvedIssue: "Underlying cause", suggestedDifferentAngle: this.expected === "repeat" ? "Inspect the upstream cause" : null };
    return { text: JSON.stringify(judgment), raw: judgment, usage: { inputTokens: 400, outputTokens: 120 } };
  }
}

for (const fixture of cases) test(fixture.name, async () => {
  const provider = new FixtureLlm(fixture.classification, fixture.confidence); const cache = new MemoryReasoningCache();
  const result = await reasonAboutRepeat(fixture.prior, fixture.current, provider, cache,
    { inputCostPerMillionTokens: 1, outputCostPerMillionTokens: 5 });
  assert.equal(result.judgment?.classification, fixture.classification);
  assert.equal(result.judgment?.confidence, fixture.confidence);
  assert.equal(result.consideredPriorAttemptIds.length, fixture.prior.length);
  assert.equal(result.estimatedApiCostUsd, .001);
  if (fixture.name.startsWith("F")) assert.deepEqual(result.contextGroups[0].attemptIds, ["f1", "f2"]);
  if (fixture.name.startsWith("G")) assert.equal(result.shouldSurface, false);
  const cached = await reasonAboutRepeat(fixture.prior, fixture.current, provider, cache);
  assert.equal(cached.cacheHit, true); assert.equal(provider.calls, 1);
});

test("sensitivity thresholds are centralized and conservative by default", () => {
  const judgment = { classification: "partial", confidence: .7 } as RepeatJudgment;
  assert.equal(shouldSurface(judgment, "cautious"), false);
  assert.equal(shouldSurface(judgment), false);
  assert.equal(shouldSurface(judgment, "aggressive"), true);
});

test("provider failures retry once and fail quietly", async () => {
  const provider: ReasoningProvider = { name: "offline", model: "none",
    async complete() { throw new Error("rate limited"); } };
  const trace = await reasonAboutRepeat([summary("p1", "Change validator")], summary("p2", "Change validator"), provider, new MemoryReasoningCache());
  assert.equal(trace.status, "failed"); assert.equal(trace.shouldSurface, false);
  assert.equal(trace.errors.length, 2); assert.equal(trace.judgment, null);
});
