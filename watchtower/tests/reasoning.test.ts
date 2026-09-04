import test from "node:test";
import assert from "node:assert/strict";
import type { AttemptSummary } from "../schema.ts";
import { RepeatReasoningEngine } from "../reason/engine.ts";
import { shouldSurface } from "../reason/policy.ts";
import type { ProviderResponse, ReasoningProvider, RepeatClassification, RepeatJudgment } from "../reason/types.ts";

const summary = (attemptId: string, approach: string, outcome: AttemptSummary["inferredOutcome"] = "failure", overrides: Partial<AttemptSummary> = {}): AttemptSummary => ({
  attemptId, problemBeingAddressed: "Malformed provider payload fails validation", intendedApproach: approach,
  actionsTaken: [approach], importantFilesOrComponents: ["provider.ts"], observedEvidence: outcome === "failure" ? ["Validation still fails"] : [],
  inferredOutcome: outcome, failureReason: outcome === "failure" ? "Validation still fails" : undefined,
  appearsToHaveAddressed: approach, mayRemainUnresolved: "Cause of malformed payload", uncertaintyAndCaveats: [], ...overrides,
});

class RecordingProvider implements ReasoningProvider {
  readonly model = "test-semantic-judge"; calls = 0; inputs: unknown[] = [];
  private readonly responses: Array<RepeatJudgment | Error>;
  constructor(responses: Array<RepeatJudgment | Error>) { this.responses = responses; }
  async judge(_prompt: string, input: unknown): Promise<ProviderResponse> {
    this.calls++; this.inputs.push(input); const response = this.responses.shift();
    if (response instanceof Error) throw response;
    return { value: response, raw: response, usage: { inputTokens: 200, outputTokens: 60, totalTokens: 260 }, estimatedCostUsd: .0002 };
  }
}

const judgment = (classification: RepeatClassification, priorAttemptIds: string[], confidence = .9): RepeatJudgment => ({
  classification, confidence, plainEnglishExplanation: classification === "repeat" ? "Claude is changing the same behavior again without addressing why it failed." : classification === "different" ? "Claude is now addressing the source of the bad data rather than changing the check." : "Claude repeats part of the earlier fix but also investigates the underlying failure.",
  repeatedStrategy: classification === "different" ? null : "change the same downstream behavior", genuinelyNewStrategy: classification === "repeat" ? null : "investigate or fix the upstream cause",
  priorAttemptIds, evidence: priorAttemptIds.map((attemptId) => ({ attemptId, reason: "The supplied summaries support this comparison" })),
  unresolvedIssue: "Underlying cause", suggestedDifferentAngle: classification === "repeat" ? "Trace the upstream cause" : null,
});

const cases: Array<{ name: string; previous: AttemptSummary[]; current: AttemptSummary; expected: RepeatClassification; confidence?: number }> = [
  { name: "A clear repeat", previous: [summary("a1", "change validator formatting")], current: summary("a2", "change another validator formatting rule", "unresolved"), expected: "repeat" },
  { name: "B genuinely different", previous: [summary("b1", "change validator formatting")], current: summary("b2", "trace malformed payload upstream and repair generation", "unresolved"), expected: "different" },
  { name: "C partial", previous: [summary("c1", "increase retry count")], current: summary("c2", "increase retries and inspect the provider failure", "unresolved"), expected: "partial" },
  { name: "D superficial wording difference", previous: [summary("d1", "relax validator regular expression")], current: summary("d2", "make the acceptance pattern more permissive", "unresolved"), expected: "repeat" },
  { name: "E same files different strategy", previous: [summary("e1", "change validator formatting")], current: summary("e2", "trace payload construction in the same module", "unresolved"), expected: "different" },
  { name: "F fragmented attempts", previous: [summary("f1", "inspect retry settings"), summary("f2", "increase retry limit")], current: summary("f3", "raise retry limit again", "unresolved"), expected: "repeat" },
  { name: "G insufficient evidence", previous: [summary("g1", "unknown", "unresolved", { actionsTaken: [], observedEvidence: [], failureReason: undefined })], current: summary("g2", "try a fix", "unresolved", { actionsTaken: [] }), expected: "partial", confidence: .25 },
];

for (const fixture of cases) test(fixture.name, async () => {
  const provider = new RecordingProvider([judgment(fixture.expected, fixture.previous.map((item) => item.attemptId), fixture.confidence)]);
  const result = await new RepeatReasoningEngine({ provider }).compare(fixture.previous, fixture.current);
  assert.equal(result.status, "judged"); if (result.status !== "judged") return;
  assert.equal(result.judgment.classification, fixture.expected);
  if (fixture.name.startsWith("F")) assert.deepEqual(result.trace.context.fragmentGroups[0].attemptIds, ["f1", "f2"]);
  if (fixture.name.startsWith("G")) assert.equal(result.trace.shouldSurface, false);
  assert.equal(provider.calls, 1);
});

test("deduplicates identical comparisons and reapplies sensitivity", async () => {
  const provider = new RecordingProvider([judgment("repeat", ["p1"], .75)]); const engine = new RepeatReasoningEngine({ provider });
  const first = await engine.compare([summary("p1", "change retry")], summary("p2", "change retry again", "unresolved"), "cautious");
  const second = await engine.compare([summary("p1", "change retry")], summary("p2", "change retry again", "unresolved"), "aggressive");
  assert.equal(first.trace.shouldSurface, false); assert.equal(second.trace.shouldSurface, true); assert.equal(second.trace.cached, true); assert.equal(provider.calls, 1);
});

test("fails quietly after malformed responses", async () => {
  const provider = new RecordingProvider([new Error("malformed JSON"), new Error("malformed JSON")]);
  const result = await new RepeatReasoningEngine({ provider }).compare([summary("x1", "retry")], summary("x2", "retry", "unresolved"));
  assert.equal(result.status, "unavailable"); assert.equal(result.trace.shouldSurface, false); assert.equal(result.trace.errors.length, 2);
});

test("central sensitivity policy avoids low-confidence noise", () => {
  assert.equal(shouldSurface(judgment("repeat", ["a"], .89), "cautious"), false);
  assert.equal(shouldSurface(judgment("partial", ["a"], .81), "balanced"), false);
  assert.equal(shouldSurface(judgment("partial", ["a"], .6), "aggressive"), true);
});
