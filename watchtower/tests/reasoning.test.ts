import test from "node:test";
import assert from "node:assert/strict";
import type { AttemptSummary } from "../schema.ts";
import { RepeatReasoningEngine } from "../reasoning/engine.ts";
import type { ReasoningProvider, ReasoningProviderResponse, RepeatClassification, RepeatJudgment } from "../reasoning/schema.ts";
import { shouldSurface, SURFACE_THRESHOLDS } from "../reasoning/sensitivity.ts";

const summary = (attemptId: string, intendedApproach: string, outcome: AttemptSummary["inferredOutcome"] = "failure",
  overrides: Partial<AttemptSummary> = {}): AttemptSummary => ({ attemptId, problemBeingAddressed: "Malformed provider payload",
    intendedApproach, actionsTaken: [], importantFilesOrComponents: [], observedEvidence: [], inferredOutcome: outcome,
    failureReason: outcome === "failure" ? "Validation still fails" : undefined, appearsToHaveAddressed: intendedApproach,
    mayRemainUnresolved: "The malformed payload's cause", uncertaintyAndCaveats: [], ...overrides });

const judgment = (classification: RepeatClassification, confidence: number, priorAttemptIds: string[]): RepeatJudgment => ({
  classification, confidence, plainEnglishExplanation: classification === "repeat"
    ? "Claude is changing the same part again without addressing why the bad data is created."
    : classification === "different" ? "Claude is now tracing where the bad data is created instead of changing how it is checked."
      : "Claude is retrying the earlier idea, but is also investigating the underlying failure.",
  repeatedStrategy: classification === "different" ? null : "Adjust the same downstream behavior",
  genuinelyNewStrategy: classification === "repeat" ? null : "Investigate and repair the upstream cause", priorAttemptIds,
  evidence: priorAttemptIds.map((attemptId) => ({ attemptId, reason: "The earlier summary establishes the failed strategy." })),
  unresolvedIssue: "Why malformed data is produced", suggestedDifferentAngle: classification === "repeat" ? "Trace payload generation" : null,
});

class InspectableFakeProvider implements ReasoningProvider {
  readonly model = "test-semantic-judge"; calls = 0; lastInput?: Parameters<ReasoningProvider["judge"]>[1];
  private readonly response: RepeatJudgment | Error;
  constructor(response: RepeatJudgment | Error) { this.response = response; }
  async judge(_prompt: string, input: Parameters<ReasoningProvider["judge"]>[1]): Promise<ReasoningProviderResponse> {
    this.calls++; this.lastInput = input; if (this.response instanceof Error) throw this.response;
    return { model: this.model, rawResponse: { omitted: true }, structuredResponse: this.response,
      usage: { inputTokens: 300, outputTokens: 80 }, estimatedCostUsd: .0002 };
  }
}

const cases: Array<{ name: string; prior: AttemptSummary[]; current: AttemptSummary; expected: RepeatClassification; confidence: number }> = [
  { name: "A clear repeat", prior: [summary("a1", "Change validator formatting")],
    current: summary("a2", "Change another formatting rule in the validator", "unresolved"), expected: "repeat", confidence: .96 },
  { name: "B genuinely different", prior: [summary("b1", "Change validator formatting")],
    current: summary("b2", "Trace generated payload upstream and repair generation logic", "unresolved"), expected: "different", confidence: .94 },
  { name: "C partial", prior: [summary("c1", "Increase provider retries")],
    current: summary("c2", "Increase retries and inspect the provider failure response", "unresolved"), expected: "partial", confidence: .88 },
  { name: "D superficial wording difference", prior: [summary("d1", "Loosen the email pattern")],
    current: summary("d2", "Broaden which character sequences the email checker accepts", "unresolved"), expected: "repeat", confidence: .91 },
  { name: "E same file, different causal strategy", prior: [summary("e1", "Relax validation", "failure", { importantFilesOrComponents: ["payload.ts"] })],
    current: summary("e2", "Fix serialization that creates malformed data", "unresolved", { importantFilesOrComponents: ["payload.ts"] }), expected: "different", confidence: .9 },
];

for (const scenario of cases) test(scenario.name, async () => {
  const provider = new InspectableFakeProvider(judgment(scenario.expected, scenario.confidence, scenario.prior.map((item) => item.attemptId)));
  const result = await new RepeatReasoningEngine(provider).compare(scenario.prior, scenario.current);
  assert.equal(result.status, "judged"); assert.equal(result.judgment?.classification, scenario.expected);
  assert.deepEqual(provider.lastInput?.priorAttempts, scenario.prior); assert.equal(result.debug.usage?.inputTokens, 300);
});

test("F fragmented attempts are supplied as one inspectable context group", async () => {
  const prior = [summary("f1", "Inspect validator inputs", "unresolved"), summary("f2", "Adjust validator formatting")];
  const provider = new InspectableFakeProvider(judgment("repeat", .93, ["f1", "f2"]));
  const result = await new RepeatReasoningEngine(provider).compare(prior, summary("f3", "Change validator formatting again", "unresolved"));
  assert.deepEqual(result.debug.adjacentContextGroups, [["f1", "f2"]]);
  assert.deepEqual(result.judgment?.priorAttemptIds, ["f1", "f2"]);
});

test("G insufficient evidence remains low confidence and does not surface", async () => {
  const provider = new InspectableFakeProvider(judgment("partial", .31, ["g1"]));
  const result = await new RepeatReasoningEngine(provider).compare([summary("g1", "Try a fix", "unresolved")], summary("g2", "Try another thing", "unresolved"));
  assert.equal(result.judgment?.confidence, .31); assert.equal(result.shouldSurface, false);
});

test("incomplete summaries are compacted without blocking reasoning", async () => {
  const incomplete = { attemptId: "thin", inferredOutcome: "unresolved" } as AttemptSummary;
  const provider = new InspectableFakeProvider(judgment("partial", .2, ["thin"]));
  const result = await new RepeatReasoningEngine(provider).compare([incomplete], { ...incomplete, attemptId: "current" });
  assert.equal(result.status, "judged"); assert.deepEqual(provider.lastInput?.priorAttempts[0].actionsTaken, []);
});

test("central thresholds, deterministic caching, successful-history filtering, and quiet provider failure", async () => {
  assert.equal(SURFACE_THRESHOLDS.balanced.repeat, .72);
  assert.equal(shouldSurface(judgment("repeat", .9, ["p"]), "cautious"), true);
  assert.equal(shouldSurface(judgment("partial", .8, ["p"]), "balanced"), false);
  const provider = new InspectableFakeProvider(judgment("repeat", .9, ["failed"]));
  const engine = new RepeatReasoningEngine(provider);
  const history = [summary("passed", "Already fixed", "success"), summary("failed", "Change validator")];
  const first = await engine.compare(history, summary("now", "Change validator again", "unresolved"));
  const second = await engine.compare(history, summary("now", "Change validator again", "unresolved"));
  assert.equal(provider.calls, 1); assert.equal(second.comparisonId, first.comparisonId); assert.equal(second.debug.cacheHit, true);
  assert.deepEqual(provider.lastInput?.priorAttempts.map((item) => item.attemptId), ["failed"]);
  const failed = await new RepeatReasoningEngine(new InspectableFakeProvider(new Error("rate limited"))).compare([summary("failed", "x")], summary("now", "y"));
  assert.equal(failed.status, "provider_error"); assert.equal(failed.shouldSurface, false); assert.match(failed.debug.errors[0], /rate limited/);
});
