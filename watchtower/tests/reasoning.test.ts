import test from "node:test";
import assert from "node:assert/strict";
import type { AttemptSummary } from "../schema.ts";
import { MemoryReasoningCache } from "../reasoning/cache.ts";
import { RepeatReasoner } from "../reasoning/engine.ts";
import { shouldSurface, SURFACE_THRESHOLDS } from "../reasoning/sensitivity.ts";
import type { ReasoningModelResponse, ReasoningProvider, ReasoningRequest, RepeatClassification, RepeatJudgment } from "../reasoning/types.ts";

const summary = (attemptId: string, intendedApproach: string, overrides: Partial<AttemptSummary> = {}): AttemptSummary => ({
  attemptId, problemBeingAddressed: "Stop malformed story payloads", intendedApproach,
  actionsTaken: [], importantFilesOrComponents: [], observedEvidence: [], inferredOutcome: "failure",
  appearsToHaveAddressed: intendedApproach, mayRemainUnresolved: "Malformed payload generation",
  uncertaintyAndCaveats: [], ...overrides,
});

function judgment(classification: RepeatClassification, confidence: number, priorAttemptIds: string[]): RepeatJudgment {
  return { classification, confidence,
    plainEnglishExplanation: classification === "repeat" ? "Claude is trying another version of the same fix without addressing why it failed."
      : classification === "different" ? "Claude is now addressing where the bad data is created, rather than changing the check again."
      : "Claude is repeating part of the old fix, but is also investigating a new possible cause.",
    repeatedStrategy: classification === "different" ? null : "Adjust the existing surface behavior",
    genuinelyNewStrategy: classification === "repeat" ? null : "Investigate and repair the underlying cause",
    priorAttemptIds, evidence: priorAttemptIds.map((attemptId) => ({ attemptId, reason: "Prior strategy remained unresolved" })),
    unresolvedIssue: "The underlying failure cause may remain", suggestedDifferentAngle: classification === "repeat" ? "Trace the upstream producer" : null };
}

class InspectableModelDouble implements ReasoningProvider {
  readonly name = "test-llm"; calls: ReasoningRequest[] = [];
  private readonly answer: RepeatJudgment | Error;
  constructor(answer: RepeatJudgment | Error) { this.answer = answer; }
  async complete(request: ReasoningRequest): Promise<ReasoningModelResponse> {
    this.calls.push(request);
    if (this.answer instanceof Error) throw this.answer;
    return { text: JSON.stringify(this.answer), raw: { structured: this.answer }, usage: { inputTokens: 300, outputTokens: 90 } };
  }
}

const cases: Array<{ name: string; history: AttemptSummary[]; current: AttemptSummary; expected: RepeatClassification; confidence: number }> = [
  { name: "A clear repeat", history: [summary("a1", "Change validator formatting", { failureReason: "Validation still fails" })],
    current: summary("a2", "Change another validator formatting rule"), expected: "repeat", confidence: .94 },
  { name: "B genuinely different", history: [summary("b1", "Change validator formatting")],
    current: summary("b2", "Trace malformed payload upstream and repair generation logic", { importantFilesOrComponents: ["story-generator.ts"] }), expected: "different", confidence: .93 },
  { name: "C partial", history: [summary("c1", "Increase retry count", { mayRemainUnresolved: "Provider failure cause" })],
    current: summary("c2", "Increase retries and inspect the underlying provider failure"), expected: "partial", confidence: .88 },
  { name: "D superficial wording difference", history: [summary("d1", "Relax the validator's accepted formatting")],
    current: summary("d2", "Broaden the gatekeeper's permitted textual shapes"), expected: "repeat", confidence: .89 },
  { name: "E same files different strategy", history: [summary("e1", "Modify validation checks", { importantFilesOrComponents: ["story.ts"] })],
    current: summary("e2", "Repair serialization before validation", { importantFilesOrComponents: ["story.ts"] }), expected: "different", confidence: .91 },
  { name: "F fragmented attempts", history: [
      summary("f1", "Change validator formatting"),
      summary("f2", "No explicit approach statement observed", { problemBeingAddressed: "Stop malformed story payloads", actionsTaken: ["Run validation test"] }),
    ], current: summary("f3", "Loosen another formatting rule"), expected: "repeat", confidence: .92 },
  { name: "G insufficient evidence", history: [summary("g1", "No explicit approach statement observed", { problemBeingAddressed: "Unknown", observedEvidence: [] })],
    current: summary("g2", "Try a fix", { problemBeingAddressed: "Unknown", actionsTaken: [] }), expected: "partial", confidence: .2 },
];

for (const scenario of cases) test(scenario.name, async () => {
  const priorIds = scenario.history.map((item) => item.attemptId);
  const provider = new InspectableModelDouble(judgment(scenario.expected, scenario.confidence, priorIds));
  const reasoner = new RepeatReasoner({ provider, model: "semantic-test-model", cache: new MemoryReasoningCache() });
  const result = await reasoner.compare(scenario.history, scenario.current);
  assert.equal(result.judgment?.classification, scenario.expected);
  assert.equal(result.judgment?.confidence, scenario.confidence);
  assert.match(provider.calls[0].system, /wording, file overlap, or file difference alone/i);
  assert.deepEqual(result.debug.priorAttemptIdsConsidered, priorIds);
  if (scenario.name.startsWith("F")) assert.deepEqual(result.debug.contextGroups[0].attemptIds, ["f1", "f2"]);
  if (scenario.name.startsWith("G")) assert.equal(result.shouldSurface, false);
});

test("deduplicates identical comparisons and records usage/cost", async () => {
  const provider = new InspectableModelDouble(judgment("repeat", .9, ["prior"]));
  const reasoner = new RepeatReasoner({ provider, model: "test", inputCostPerMillionTokens: 3, outputCostPerMillionTokens: 15 });
  const history = [summary("prior", "Change retry count")]; const current = summary("current", "Raise retry count again");
  const first = await reasoner.compare(history, current); const second = await reasoner.compare(history, current);
  assert.equal(provider.calls.length, 1);
  assert.equal(second.cached, true);
  assert.equal(second.shouldSurface, false);
  assert.equal(first.debug.estimatedCostUsd, .00225);
  assert.equal(first.comparisonId, second.comparisonId);
});

test("provider and parsing failures fail quietly", async () => {
  const provider = new InspectableModelDouble(new Error("rate limited"));
  const result = await new RepeatReasoner({ provider, model: "test" }).compare([summary("p", "Try it")], summary("n", "Try again"));
  assert.equal(result.judgment, null); assert.equal(result.shouldSurface, false);
  assert.match(result.debug.errors[0], /rate limited/);
});

test("central sensitivity thresholds avoid noisy surfaces", () => {
  const partial = judgment("partial", .84, ["a"]); const repeat = judgment("repeat", .76, ["a"]);
  assert.deepEqual(SURFACE_THRESHOLDS.balanced, { repeat: .75, partial: .85 });
  assert.equal(shouldSurface(partial), false);
  assert.equal(shouldSurface(repeat), true);
  assert.equal(shouldSurface(partial, "aggressive"), true);
  assert.equal(shouldSurface(repeat, "cautious"), false);
});
