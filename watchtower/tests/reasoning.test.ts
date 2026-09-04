import test from "node:test";
import assert from "node:assert/strict";
import type { AttemptSummary } from "../schema.ts";
import { RepeatReasoningEngine } from "../reasoning/engine.ts";
import { shouldSurface } from "../reasoning/policy.ts";
import type { ProviderResponse, ReasoningProvider, RepeatClassification, RepeatJudgment } from "../reasoning/types.ts";

const summary = (attemptId: string, approach: string, outcome: AttemptSummary["inferredOutcome"] = "failure", overrides: Partial<AttemptSummary> = {}): AttemptSummary => ({
  attemptId, problemBeingAddressed: "Requests fail validation", intendedApproach: approach,
  actionsTaken: [approach], importantFilesOrComponents: [], observedEvidence: outcome === "failure" ? ["Validation still fails"] : [],
  inferredOutcome: outcome, failureReason: outcome === "failure" ? "Validation still fails" : undefined,
  appearsToHaveAddressed: approach, mayRemainUnresolved: "Malformed generated payload", uncertaintyAndCaveats: [], ...overrides,
});

const judgment = (classification: RepeatClassification, priorAttemptIds: string[], confidence = .9): RepeatJudgment => ({
  classification, confidence,
  plainEnglishExplanation: classification === "repeat" ? "Claude is changing the same part again without addressing why the bad data is created."
    : classification === "different" ? "Claude is now fixing where the bad data is created instead of changing the check that rejects it."
    : "Claude is repeating part of the earlier fix but also investigating the underlying failure.",
  repeatedStrategy: classification === "different" ? null : "Adjust the existing surface behavior",
  genuinelyNewStrategy: classification === "repeat" ? null : "Trace and fix the underlying cause",
  priorAttemptIds, evidence: priorAttemptIds.map((attemptId) => ({ attemptId, reason: "The supplied summary supports this comparison" })),
  unresolvedIssue: "The underlying cause may remain", suggestedDifferentAngle: classification === "repeat" ? "Trace the source of the malformed data" : null,
});

class RecordingProvider implements ReasoningProvider {
  readonly model = "test-semantic-judge"; calls = 0; inputs: unknown[] = [];
  private readonly result: RepeatJudgment | Error;
  constructor(result: RepeatJudgment | Error) { this.result = result; }
  async complete(_prompt: string, input: unknown): Promise<ProviderResponse> {
    this.calls++; this.inputs.push(input);
    if (this.result instanceof Error) throw this.result;
    return { model: this.model, text: JSON.stringify(this.result), tokenUsage: { inputTokens: 120, outputTokens: 55 } };
  }
}

const cases: Array<{ name: string; prior: AttemptSummary[]; current: AttemptSummary; expected: RepeatClassification; confidence?: number }> = [
  { name: "A clear repeat", prior: [summary("a1", "Change validator formatting rules")], current: summary("a2", "Change another validator formatting rule"), expected: "repeat" },
  { name: "B genuinely different", prior: [summary("b1", "Change validator formatting rules")], current: summary("b2", "Trace payload upstream and repair malformed generation", "unresolved", { importantFilesOrComponents: ["payload-generator"] }), expected: "different" },
  { name: "C partial overlap", prior: [summary("c1", "Increase retry count")], current: summary("c2", "Increase retries and inspect the provider failure", "unresolved"), expected: "partial" },
  { name: "D superficial wording difference", prior: [summary("d1", "Loosen the email validation regex")], current: summary("d2", "Broaden the pattern accepted by the address checker"), expected: "repeat" },
  { name: "E same files different strategy", prior: [summary("e1", "Adjust validation in request.ts", "failure", { importantFilesOrComponents: ["request.ts"] })], current: summary("e2", "Correct serialization before validation in request.ts", "unresolved", { importantFilesOrComponents: ["request.ts"] }), expected: "different" },
  { name: "F fragmented attempts", prior: [summary("f1", "Inspect validator", "unresolved"), summary("f2", "Change validator formatting")], current: summary("f3", "Alter another validator formatting branch"), expected: "repeat" },
  { name: "G insufficient evidence", prior: [summary("g1", "Try a fix", "unresolved", { observedEvidence: [], failureReason: undefined })], current: summary("g2", "Try another fix", "unresolved", { observedEvidence: [] }), expected: "partial", confidence: .25 },
];

for (const scenario of cases) test(scenario.name, async () => {
  const ids = scenario.prior.map((item) => item.attemptId);
  const provider = new RecordingProvider(judgment(scenario.expected, ids, scenario.confidence));
  const result = await new RepeatReasoningEngine(provider).judge(scenario.prior, scenario.current);
  assert.equal(result.judgment?.classification, scenario.expected);
  assert.deepEqual(result.trace.consideredPriorAttemptIds, ids);
  assert.equal(result.shouldSurface, scenario.name === "G insufficient evidence" ? false : scenario.expected !== "different");
  assert.match(JSON.stringify(provider.inputs[0]), new RegExp(scenario.current.attemptId));
  if (scenario.name === "F fragmented attempts") assert.deepEqual(result.judgment?.priorAttemptIds, ["f1", "f2"]);
});

test("identical comparisons use cache and do not call the provider twice", async () => {
  const provider = new RecordingProvider(judgment("repeat", ["cache-1"]));
  const engine = new RepeatReasoningEngine(provider);
  const prior = [summary("cache-1", "Change validator")]; const current = summary("cache-2", "Change validator again");
  const first = await engine.judge(prior, current); const second = await engine.judge(prior, current, "aggressive");
  assert.equal(first.comparisonId, second.comparisonId); assert.equal(provider.calls, 1); assert.equal(second.trace.cacheHit, true);
});

test("provider failures fail quietly after one retry", async () => {
  const provider = new RecordingProvider(new Error("rate limited"));
  const result = await new RepeatReasoningEngine(provider).judge([summary("fail-1", "Change validator")], summary("fail-2", "Change it again"));
  assert.equal(result.judgment, null); assert.equal(result.shouldSurface, false); assert.equal(provider.calls, 2); assert.equal(result.trace.errors.length, 2);
});

test("sensitivity thresholds are centralized and conservative", () => {
  assert.equal(shouldSurface(judgment("repeat", ["a"], .8), "cautious"), false);
  assert.equal(shouldSurface(judgment("repeat", ["a"], .8), "balanced"), true);
  assert.equal(shouldSurface(judgment("partial", ["a"], .7), "balanced"), false);
  assert.equal(shouldSurface(judgment("partial", ["a"], .7), "aggressive"), true);
});
