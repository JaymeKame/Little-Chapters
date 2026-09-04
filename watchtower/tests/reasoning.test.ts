import test from "node:test";
import assert from "node:assert/strict";
import type { AttemptSummary } from "../schema.ts";
import { shouldSurface, SURFACE_THRESHOLDS } from "../reasoning/decision.ts";
import { RepeatReasoningEngine } from "../reasoning/engine.ts";
import { REPEAT_REASONING_PROMPT_VERSION } from "../reasoning/prompt.ts";
import { MemoryReasoningStore } from "../reasoning/store.ts";
import type { ReasoningProvider, RepeatClassification, RepeatJudgment } from "../reasoning/types.ts";

const summary = (attemptId: string, approach: string, outcome: AttemptSummary["inferredOutcome"] = "failure", overrides: Partial<AttemptSummary> = {}): AttemptSummary => ({
  attemptId, problemBeingAddressed: "Malformed payload fails validation", intendedApproach: approach,
  actionsTaken: [approach], importantFilesOrComponents: ["validation.ts"], observedEvidence: ["Validation still fails"],
  inferredOutcome: outcome, failureReason: outcome === "failure" ? "Malformed output remains" : undefined,
  appearsToHaveAddressed: approach, mayRemainUnresolved: "Why generation creates malformed output",
  uncertaintyAndCaveats: [], ...overrides,
});

class ScriptedProvider implements ReasoningProvider {
  readonly model = "test-semantic-judge"; calls = 0; lastInput = "";
  private readonly judgment: unknown;
  constructor(judgmentValue: RepeatJudgment | unknown) { this.judgment = judgmentValue; }
  async reason(_instructions: string, input: string) {
    this.calls++; this.lastInput = input;
    return { model: this.model, structuredResponse: this.judgment, tokenUsage: { inputTokens: 120, outputTokens: 60, totalTokens: 180 } };
  }
}

const judgment = (classification: RepeatClassification, confidence: number, ids: string[]): RepeatJudgment => ({
  classification, confidence, plainEnglishExplanation: classification === "repeat"
    ? "Claude is changing the same part again without addressing why the bad data is created."
    : classification === "different" ? "Claude is now tracing where the bad data is created instead of changing the check again."
      : "Claude is retrying the old fix, but also investigating why the provider fails.",
  repeatedStrategy: classification === "different" ? null : "Adjust the previously changed behavior",
  genuinelyNewStrategy: classification === "repeat" ? null : "Investigate and repair the underlying cause",
  priorAttemptIds: ids, evidence: ids.map((attemptId) => ({ attemptId, reason: "Prior attempt did not resolve the cause" })),
  unresolvedIssue: "Underlying cause may remain", suggestedDifferentAngle: classification === "repeat" ? "Trace the source of malformed data" : null,
});

const cases: Array<{ name: string; previous: AttemptSummary[]; current: AttemptSummary; expected: RepeatClassification; confidence?: number }> = [
  { name: "A — clear validator repeat", previous: [summary("a1", "Change validator formatting")],
    current: summary("a2", "Change another validator formatting rule", "unresolved"), expected: "repeat" },
  { name: "B — genuinely different upstream fix", previous: [summary("b1", "Change validator formatting")],
    current: summary("b2", "Trace generated payload upstream and repair generation", "unresolved", { importantFilesOrComponents: ["generator.ts"] }), expected: "different" },
  { name: "C — retry overlap plus provider investigation", previous: [summary("c1", "Increase retry count")],
    current: summary("c2", "Increase retries and inspect the underlying provider failure", "unresolved"), expected: "partial" },
  { name: "D — different words, same validation strategy", previous: [summary("d1", "Relax the validator regex")],
    current: summary("d2", "Broaden the accepted character pattern", "unresolved"), expected: "repeat" },
  { name: "E — same file but different causal mechanism", previous: [summary("e1", "Relax validation rules")],
    current: summary("e2", "Trace serialization and repair malformed generation", "unresolved"), expected: "different" },
  { name: "F — fragmented prior strategy", previous: [summary("f1", "Inspect validator", "unresolved"), summary("f2", "Change validator formatting")],
    current: summary("f3", "Change another validator formatting rule", "unresolved"), expected: "repeat" },
  { name: "G — insufficient evidence", previous: [summary("g1", "Tried a fix", "unresolved", { actionsTaken: [], observedEvidence: [] })],
    current: summary("g2", "Try something else", "unresolved", { actionsTaken: [], observedEvidence: [] }), expected: "partial", confidence: .25 },
];

for (const scenario of cases) test(scenario.name, async () => {
  const response = judgment(scenario.expected, scenario.confidence ?? .91, scenario.previous.map((item) => item.attemptId));
  const provider = new ScriptedProvider(response);
  const trace = await new RepeatReasoningEngine({ provider }).compare(scenario.previous, scenario.current);
  assert.equal(trace.judgment?.classification, scenario.expected);
  assert.equal(trace.promptVersion, REPEAT_REASONING_PROMPT_VERSION);
  assert.match(provider.lastInput, new RegExp(scenario.current.attemptId));
  if (scenario.name.startsWith("F")) assert.deepEqual(trace.adjacentFragmentGroups, [["f1", "f2"]]);
  if (scenario.name.startsWith("G")) assert.equal(trace.shouldSurface, false);
});

test("completed comparison identity caches provider result and recalculates sensitivity", async () => {
  const provider = new ScriptedProvider(judgment("repeat", .75, ["cache-1"])); const store = new MemoryReasoningStore();
  const engine = new RepeatReasoningEngine({ provider, store }); const prior = [summary("cache-1", "Change retries")]; const current = summary("cache-2", "Raise retries again");
  assert.equal((await engine.compare(prior, current, "balanced")).shouldSurface, true);
  const cached = await engine.compare(prior, current, "cautious");
  assert.equal(cached.cacheHit, true); assert.equal(cached.shouldSurface, false); assert.equal(provider.calls, 1);
});

test("provider and parsing failures are quiet, recorded, and never surfaced", async () => {
  const provider = new ScriptedProvider({ classification: "certainly" });
  const trace = await new RepeatReasoningEngine({ provider, timeoutMs: 50 }).compare([summary("bad-1", "Change retries")], summary("bad-2", "Change retries"));
  assert.equal(trace.status, "unavailable"); assert.equal(trace.judgment, null); assert.equal(trace.shouldSurface, false);
  assert.equal(trace.errors.length, 2); assert.equal(provider.calls, 2);
});

test("sensitivity thresholds are centralized and partial behavior is intentional", () => {
  assert.deepEqual(SURFACE_THRESHOLDS.balanced, { repeat: .72, partial: .85 });
  assert.equal(shouldSurface(judgment("partial", .8, ["x"]), "balanced"), false);
  assert.equal(shouldSurface(judgment("partial", .8, ["x"]), "aggressive"), true);
});
