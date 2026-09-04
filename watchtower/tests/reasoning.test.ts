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

test("uses the model judgment and exposes compact fragment context", async () => {
  const prior = [summary("f1", { problemBeingAddressed: "Provider timeout", intendedApproach: "Begin retry change" }),
    summary("f2", { problemBeingAddressed: "Provider timeout", intendedApproach: "Complete retry change" })];
  const current = summary("f3", { problemBeingAddressed: "Provider timeout", intendedApproach: "Raise retries again" });
  const provider = new FakeModel(response("repeat", .88, ["f1", "f2"]));
  const result = await new RepeatReasoningEngine({ provider, cache: new MemoryReasoningCache() }).compare(prior, current);
  assert.equal(result.judgment?.classification, "repeat");
  assert.equal(result.trace.promptVersion, REPEAT_REASONING_PROMPT_VERSION);
  assert.deepEqual(result.trace.contextGroups[0].attemptIds, ["f1", "f2"]);
  assert.ok(result.trace.transmittedInput.includes(current.attemptId));
  assert.equal(provider.calls.length, 1);
});

test("cache identity deduplicates provider calls and downstream surfaces", async () => {
  const provider = new FakeModel(response("repeat", .95, ["prior"]));
  const engine = new RepeatReasoningEngine({ provider, cache: new MemoryReasoningCache() });
  const history = [summary("prior", { intendedApproach: "Raise retries" })];
  const current = summary("current", { intendedApproach: "Raise retries again" });
  assert.equal((await engine.compare(history, current)).duplicate, false);
  const duplicate = await engine.compare(history, current);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.shouldSurface, false);
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

test("temporarily caches provider failures to avoid hammering an unavailable API", async () => {
  const provider = new FakeModel(new Error("rate limited"));
  const engine = new RepeatReasoningEngine({ provider, cache: new MemoryReasoningCache() });
  const history = [summary("prior", {})]; const current = summary("current", {});
  assert.equal((await engine.compare(history, current)).duplicate, false);
  const duplicate = await engine.compare(history, current);
  assert.equal(duplicate.status, "failed");
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.shouldSurface, false);
  assert.equal(provider.calls.length, 2); // initial request plus its single parse/provider retry
});

test("sensitivity thresholds are centralized and balanced is default", () => {
  const partial = response("partial", .83, ["prior"]);
  assert.equal(shouldSurface(partial, "cautious"), false);
  assert.equal(shouldSurface(partial), true);
  assert.equal(shouldSurface({ ...partial, confidence: .6 }, "aggressive"), true);
});
