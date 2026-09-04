import test from "node:test";
import assert from "node:assert/strict";
import type { AttemptSummary } from "../schema.ts";
import { MemoryReasoningCache } from "../reasoning/cache.ts";
import { RepeatReasoningEngine } from "../reasoning/engine.ts";
import { REPEAT_REASONING_PROMPT_VERSION } from "../reasoning/prompt.ts";
import { shouldSurface } from "../reasoning/sensitivity.ts";
import type { ProviderResponse, ReasoningProvider, RepeatClassification, RepeatJudgment } from "../reasoning/types.ts";

const summary = (attemptId: string, values: Partial<AttemptSummary>): AttemptSummary => ({
  attemptId, problemBeingAddressed: "Fix malformed story payload", intendedApproach: "Unknown",
  actionsTaken: [], importantFilesOrComponents: [], observedEvidence: [], inferredOutcome: "failure",
  appearsToHaveAddressed: "Unknown", mayRemainUnresolved: "Malformed output remains",
  uncertaintyAndCaveats: [], ...values,
});

const response = (classification: RepeatClassification, confidence: number, priorAttemptIds: string[]): RepeatJudgment => ({
  classification, confidence,
  plainEnglishExplanation: classification === "repeat"
    ? "Claude is trying another version of the same fix without addressing why it failed."
    : classification === "different" ? "Claude is now working on the cause of the bad data, not another validator adjustment."
      : "Claude is repeating part of the old fix but also investigating a new cause.",
  repeatedStrategy: classification === "different" ? null : "Adjust the same downstream behavior",
  genuinelyNewStrategy: classification === "repeat" ? null : "Investigate and repair the underlying cause",
  priorAttemptIds, evidence: priorAttemptIds.map((attemptId) => ({ attemptId, reason: "This attempt established the earlier strategy and outcome." })),
  unresolvedIssue: "The underlying cause may remain", suggestedDifferentAngle: "Trace the data to its source",
});

class FakeModel implements ReasoningProvider {
  readonly model = "fixture-semantic-judge";
  calls: Array<{ system: string; input: string }> = [];
  private readonly judgment: RepeatJudgment | Error;
  private readonly malformedFirst: boolean;
  constructor(judgment: RepeatJudgment | Error, malformedFirst = false) {
    this.judgment = judgment;
    this.malformedFirst = malformedFirst;
  }
  async complete(system: string, input: string): Promise<ProviderResponse> {
    this.calls.push({ system, input });
    if (this.judgment instanceof Error) throw this.judgment;
    if (this.malformedFirst && this.calls.length === 1) return { model: this.model, text: "not json" };
    return { model: this.model, text: JSON.stringify(this.judgment), usage: { inputTokens: 250, outputTokens: 80 } };
  }
}

type Case = { name: string; prior: AttemptSummary[]; current: AttemptSummary; expected: RepeatClassification; confidence?: number };
const cases: Case[] = [
  { name: "A clear repeat", prior: [summary("a1", { intendedApproach: "Change validator formatting", actionsTaken: ["Relaxed validator format"], failureReason: "Validation still fails" })],
    current: summary("a2", { intendedApproach: "Change another validator formatting rule" }), expected: "repeat" },
  { name: "B genuinely different", prior: [summary("b1", { intendedApproach: "Change validator formatting", failureReason: "Malformed generated payload remains" })],
    current: summary("b2", { intendedApproach: "Trace payload upstream and repair generation", importantFilesOrComponents: ["payload-generator.ts"] }), expected: "different" },
  { name: "C partial overlap", prior: [summary("c1", { intendedApproach: "Increase retries", problemBeingAddressed: "Provider requests fail" })],
    current: summary("c2", { intendedApproach: "Increase retries and inspect the provider failure", problemBeingAddressed: "Provider requests fail" }), expected: "partial" },
  { name: "D superficial wording difference", prior: [summary("d1", { intendedApproach: "Loosen the email pattern" })],
    current: summary("d2", { intendedApproach: "Permit a broader set of characters in addresses" }), expected: "repeat" },
  { name: "E same file different strategy", prior: [summary("e1", { intendedApproach: "Adjust validation rules", importantFilesOrComponents: ["payload.ts"] })],
    current: summary("e2", { intendedApproach: "Correct serialization order", importantFilesOrComponents: ["payload.ts"] }), expected: "different" },
  { name: "F fragmented attempts", prior: [
    summary("f1", { problemBeingAddressed: "Provider timeout", intendedApproach: "Begin retry change" }),
    summary("f2", { problemBeingAddressed: "Provider timeout", intendedApproach: "Complete and test retry change" }),
  ], current: summary("f3", { problemBeingAddressed: "Provider timeout", intendedApproach: "Raise retries again" }), expected: "repeat" },
  { name: "G insufficient evidence", prior: [summary("g1", { problemBeingAddressed: "Unknown", intendedApproach: "Unknown", actionsTaken: [], observedEvidence: [] })],
    current: summary("g2", { problemBeingAddressed: "Unknown", intendedApproach: "Try something", actionsTaken: [] }), expected: "partial", confidence: .2 },
];

for (const scenario of cases) {
  test(scenario.name, async () => {
    const ids = scenario.prior.map((item) => item.attemptId);
    const provider = new FakeModel(response(scenario.expected, scenario.confidence ?? .88, ids));
    const engine = new RepeatReasoningEngine({ provider, cache: new MemoryReasoningCache() });
    const result = await engine.compare(scenario.prior, scenario.current);
    assert.equal(result.judgment?.classification, scenario.expected);
    assert.equal(result.trace.promptVersion, REPEAT_REASONING_PROMPT_VERSION);
    assert.deepEqual(result.trace.consideredPriorAttemptIds, ids);
    assert.equal(provider.calls.length, 1);
    assert.ok(provider.calls[0].input.includes(scenario.current.attemptId));
    if (scenario.name.startsWith("F")) assert.deepEqual(result.trace.contextGroups[0].attemptIds, ["f1", "f2"]);
    if (scenario.name.startsWith("G")) assert.equal(result.shouldSurface, false);
  });
}

test("cache identity deduplicates provider calls and downstream surfaces", async () => {
  const provider = new FakeModel(response("repeat", .95, ["prior"]));
  const engine = new RepeatReasoningEngine({ provider, cache: new MemoryReasoningCache() });
  const history = [summary("prior", { intendedApproach: "Raise retries" })];
  const current = summary("current", { intendedApproach: "Raise retries again" });
  assert.equal((await engine.compare(history, current)).duplicate, false);
  const duplicate = await engine.compare(history, current);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.shouldSurface, true);
  assert.equal(provider.calls.length, 1);
});

test("malformed responses retry once and provider failure remains advisory", async () => {
  const history = [summary("prior", {})]; const current = summary("current", {});
  const retryProvider = new FakeModel(response("partial", .84, ["prior"]), true);
  const retried = await new RepeatReasoningEngine({ provider: retryProvider, cache: new MemoryReasoningCache() }).compare(history, current);
  assert.equal(retried.status, "evaluated");
  assert.equal(retryProvider.calls.length, 2);
  assert.equal(retried.trace.errors.length, 1);
  const failed = await new RepeatReasoningEngine({ provider: new FakeModel(new Error("rate limited")), cache: new MemoryReasoningCache() }).compare(history, current);
  assert.equal(failed.status, "failed");
  assert.equal(failed.shouldSurface, false);
  assert.equal(failed.trace.errors.length, 2);
});

test("sensitivity thresholds are centralized and balanced is default", () => {
  const partial = response("partial", .83, ["prior"]);
  assert.equal(shouldSurface(partial, "cautious"), false);
  assert.equal(shouldSurface(partial), true);
  assert.equal(shouldSurface({ ...partial, confidence: .6 }, "aggressive"), true);
});
