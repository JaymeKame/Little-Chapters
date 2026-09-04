import test from "node:test";
import assert from "node:assert/strict";
import type { AttemptSummary } from "../schema.ts";
import { RepeatReasoningEngine } from "../reasoning/engine.ts";
import { shouldSurface, SURFACE_THRESHOLDS } from "../reasoning/decision.ts";
import { REPEAT_REASONING_PROMPT_VERSION } from "../reasoning/prompt.ts";
import type { ReasoningProvider, ReasoningProviderResponse, RepeatClassification } from "../reasoning/types.ts";

const summary = (attemptId: string, approach: string, outcome: AttemptSummary["inferredOutcome"] = "failure", extra: Partial<AttemptSummary> = {}): AttemptSummary => ({
  attemptId, problemBeingAddressed: "Stop malformed requests from failing validation", intendedApproach: approach,
  actionsTaken: [approach], importantFilesOrComponents: [], observedEvidence: outcome === "failure" ? ["Validation still fails"] : [],
  inferredOutcome: outcome, failureReason: outcome === "failure" ? "The malformed request was unchanged" : undefined,
  appearsToHaveAddressed: approach, mayRemainUnresolved: "The source of malformed data", uncertaintyAndCaveats: [], ...extra,
});

class FixtureJudge implements ReasoningProvider {
  calls: Array<{ system: string; input: string }> = [];
  private readonly response: RepeatClassification;
  private readonly confidence: number;
  constructor(response: RepeatClassification, confidence = .9) { this.response = response; this.confidence = confidence; }
  async complete(request: { system: string; input: string }): Promise<ReasoningProviderResponse> {
    this.calls.push(request);
    const input = JSON.parse(request.input) as { priorFailedOrUnresolved: AttemptSummary[] };
    return { model: "fixture-semantic-judge", usage: { inputTokens: 120, outputTokens: 60 }, text: JSON.stringify({
      classification: this.response, confidence: this.confidence,
      plainEnglishExplanation: this.response === "repeat" ? "Claude is trying another version of the same fix without addressing why it failed."
        : this.response === "different" ? "Claude is now tracing where the bad data is created instead of changing the check again."
        : "Claude is repeating part of the earlier fix, but is also investigating a new cause.",
      repeatedStrategy: this.response === "different" ? null : "Adjust the existing surface behavior",
      genuinelyNewStrategy: this.response === "repeat" ? null : "Investigate and repair the underlying cause",
      priorAttemptIds: input.priorFailedOrUnresolved.map((item) => item.attemptId),
      evidence: input.priorFailedOrUnresolved.map((item) => ({ attemptId: item.attemptId, reason: item.intendedApproach })),
      unresolvedIssue: "The underlying cause may remain", suggestedDifferentAngle: this.response === "repeat" ? "Trace the data to its source" : null,
    }) };
  }
}

const cases: Array<{ name: string; prior: AttemptSummary[]; current: AttemptSummary; expected: RepeatClassification }> = [
  { name: "A clear repeat", prior: [summary("a1", "Change validator formatting")], current: summary("a2", "Change another validator formatting rule", "unresolved"), expected: "repeat" },
  { name: "B genuinely different", prior: [summary("b1", "Change validator formatting")], current: summary("b2", "Trace the payload upstream and repair generation", "unresolved"), expected: "different" },
  { name: "C partial", prior: [summary("c1", "Increase retry count")], current: summary("c2", "Increase retries and inspect the provider failure", "unresolved"), expected: "partial" },
  { name: "D superficial wording difference", prior: [summary("d1", "Loosen the email regular expression")], current: summary("d2", "Broaden the pattern that accepts email text", "unresolved"), expected: "repeat" },
  { name: "E same file, different strategy", prior: [summary("e1", "Change validator rules", "failure", { importantFilesOrComponents: ["request.ts"] })], current: summary("e2", "Repair payload serialization", "unresolved", { importantFilesOrComponents: ["request.ts"] }), expected: "different" },
  { name: "F fragmented attempts", prior: [summary("f1", "Inspect validator", "unresolved"), summary("f2", "Change validator formatting")], current: summary("f3", "Modify validator formatting again", "unresolved"), expected: "repeat" },
];

for (const fixture of cases) test(fixture.name, async () => {
  const provider = new FixtureJudge(fixture.expected);
  const result = await new RepeatReasoningEngine(provider).compare(fixture.prior, fixture.current);
  assert.equal(result.judgment?.classification, fixture.expected);
  assert.equal(provider.calls.length, 1);
  assert.equal(result.trace.promptVersion, REPEAT_REASONING_PROMPT_VERSION);
  assert.deepEqual(result.trace.consideredPriorAttemptIds, fixture.prior.map((item) => item.attemptId));
  if (fixture.name.startsWith("F")) assert.match(result.trace.fragmentHandling, /fragments/);
});

test("G insufficient evidence stays low confidence and does not surface", async () => {
  const provider = new FixtureJudge("partial", .3);
  const thin = summary("g1", "Try something", "unresolved", { observedEvidence: [], failureReason: undefined });
  const result = await new RepeatReasoningEngine(provider).compare([thin], summary("g2", "Make a change", "unresolved"));
  assert.equal(result.judgment?.classification, "partial");
  assert.equal(result.shouldSurface, false);
});

test("cache deduplicates identical comparisons without another provider call", async () => {
  const provider = new FixtureJudge("repeat"); const engine = new RepeatReasoningEngine(provider);
  const prior = [summary("cache-1", "Change validator")]; const current = summary("cache-2", "Change validator again", "unresolved");
  const first = await engine.compare(prior, current); const second = await engine.compare(prior, current);
  assert.equal(provider.calls.length, 1); assert.equal(first.comparisonId, second.comparisonId);
  assert.equal(second.duplicate, true); assert.equal(second.trace.cacheHit, true);
});

test("surface thresholds are centralized for all sensitivities", () => {
  const judgment = { classification: "repeat", confidence: .8 } as Parameters<typeof shouldSurface>[0];
  assert.equal(shouldSurface(judgment, "cautious"), false);
  assert.equal(shouldSurface(judgment, "balanced"), true);
  assert.equal(shouldSurface({ ...judgment, classification: "different" }, "aggressive"), false);
  assert.deepEqual(Object.keys(SURFACE_THRESHOLDS), ["cautious", "balanced", "aggressive"]);
});

test("malformed provider output retries then fails quietly", async () => {
  let calls = 0;
  const provider: ReasoningProvider = { async complete() { calls++; return { model: "broken", text: "not json" }; } };
  const result = await new RepeatReasoningEngine(provider).compare([summary("bad-1", "Change validator")], summary("bad-2", "Change validator", "unresolved"));
  assert.equal(calls, 2); assert.equal(result.judgment, null); assert.equal(result.shouldSurface, false);
  assert.equal(result.trace.parsingAndRetryErrors.length, 2);
});
