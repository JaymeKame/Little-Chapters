import test from "node:test";
import assert from "node:assert/strict";
import type { AttemptSummary } from "../schema.ts";
import { RepeatReasoningEngine } from "../reasoning/engine.ts";
import { AnthropicReasoningProvider } from "../reasoning/provider.ts";
import type { RepeatClassification } from "../reasoning/types.ts";

const configured = Boolean(process.env.ANTHROPIC_API_KEY && process.env.WATCHTOWER_REASONING_MODEL);
const summary = (attemptId: string, intendedApproach: string, extra: Partial<AttemptSummary> = {}): AttemptSummary => ({
  attemptId, problemBeingAddressed: "Requests contain malformed generated data", intendedApproach,
  actionsTaken: [intendedApproach], importantFilesOrComponents: [], observedEvidence: ["Validation still fails"],
  inferredOutcome: "failure", failureReason: "Malformed generated data still fails validation",
  appearsToHaveAddressed: intendedApproach, mayRemainUnresolved: "Why generated data is malformed",
  uncertaintyAndCaveats: [], ...extra,
});

const cases: Array<{ name: string; prior: AttemptSummary[]; current: AttemptSummary; expected: RepeatClassification }> = [
  { name: "A clear repeat", prior: [summary("a1", "Change validator formatting")], current: summary("a2", "Change another validator formatting rule", { inferredOutcome: "unresolved" }), expected: "repeat" },
  { name: "B genuinely different", prior: [summary("b1", "Change validator formatting")], current: summary("b2", "Trace malformed values upstream and repair payload generation", { inferredOutcome: "unresolved" }), expected: "different" },
  { name: "C partial", prior: [summary("c1", "Increase retry count")], current: summary("c2", "Increase retries again and also inspect the underlying provider failure", { inferredOutcome: "unresolved" }), expected: "partial" },
  { name: "D wording differs but strategy repeats", prior: [summary("d1", "Loosen the email regular expression")], current: summary("d2", "Broaden the pattern that accepts email-shaped text", { inferredOutcome: "unresolved" }), expected: "repeat" },
  { name: "E same file with different cause", prior: [summary("e1", "Change validator rules", { importantFilesOrComponents: ["request.ts"] })], current: summary("e2", "Repair payload serialization before validation", { inferredOutcome: "unresolved", importantFilesOrComponents: ["request.ts"] }), expected: "different" },
  { name: "F adjacent fragments considered together", prior: [summary("f1", "Inspect validator inputs", { inferredOutcome: "unresolved" }), summary("f2", "Change validator formatting")], current: summary("f3", "Modify validator formatting again", { inferredOutcome: "unresolved" }), expected: "repeat" },
];

for (const fixture of cases) test(fixture.name, { skip: !configured && "Reasoning provider credentials are not configured" }, async () => {
  const result = await new RepeatReasoningEngine(new AnthropicReasoningProvider(), { timeoutMs: 30_000 }).compare(fixture.prior, fixture.current);
  assert.equal(result.judgment?.classification, fixture.expected, result.judgment?.plainEnglishExplanation);
});

test("G insufficient evidence is cautious", { skip: !configured && "Reasoning provider credentials are not configured" }, async () => {
  const prior = summary("g1", "Try something", { observedEvidence: [], failureReason: undefined, mayRemainUnresolved: "Unknown" });
  const current = summary("g2", "Make a change", { observedEvidence: [], inferredOutcome: "unresolved", mayRemainUnresolved: "Unknown" });
  const result = await new RepeatReasoningEngine(new AnthropicReasoningProvider(), { timeoutMs: 30_000 }).compare([prior], current);
  assert.ok((result.judgment?.confidence ?? 1) < .72);
  assert.equal(result.shouldSurface, false);
});
