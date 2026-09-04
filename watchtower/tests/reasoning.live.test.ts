import test from "node:test";
import assert from "node:assert/strict";
import type { AttemptSummary } from "../schema.ts";
import { MemoryReasoningCache } from "../reasoning/cache.ts";
import { RepeatReasoningEngine } from "../reasoning/engine.ts";
import { AnthropicReasoningProvider } from "../reasoning/provider-anthropic.ts";
import type { RepeatClassification } from "../reasoning/types.ts";

const apiKey = process.env.ANTHROPIC_API_KEY;
const live = apiKey ? test : test.skip;
const summary = (attemptId: string, values: Partial<AttemptSummary>): AttemptSummary => ({
  attemptId, problemBeingAddressed: "Fix malformed output", intendedApproach: "Unknown", actionsTaken: [],
  importantFilesOrComponents: [], observedEvidence: [], inferredOutcome: "failure",
  appearsToHaveAddressed: "Unknown", mayRemainUnresolved: "The original problem", uncertaintyAndCaveats: [], ...values,
});

const cases: Array<{ name: string; prior: AttemptSummary[]; current: AttemptSummary; expected: RepeatClassification; lowConfidence?: boolean }> = [
  { name: "A clear repeat", prior: [summary("a1", { intendedApproach: "Change validator formatting", actionsTaken: ["Relaxed validator formatting"], failureReason: "Validation still rejects malformed generated data" })], current: summary("a2", { intendedApproach: "Change another validator formatting rule" }), expected: "repeat" },
  { name: "B genuinely different", prior: [summary("b1", { intendedApproach: "Change validator formatting", failureReason: "Malformed generated payload remains" })], current: summary("b2", { intendedApproach: "Trace the malformed payload upstream and repair generation", actionsTaken: ["Inspect payload construction", "Correct generation logic"] }), expected: "different" },
  { name: "C partial", prior: [summary("c1", { intendedApproach: "Increase request retries", problemBeingAddressed: "Provider requests fail" })], current: summary("c2", { intendedApproach: "Increase retries again and inspect the underlying provider failure", problemBeingAddressed: "Provider requests fail" }), expected: "partial" },
  { name: "D superficial wording difference", prior: [summary("d1", { intendedApproach: "Loosen the email validation pattern" })], current: summary("d2", { intendedApproach: "Permit a broader character set in email addresses" }), expected: "repeat" },
  { name: "E same file different strategy", prior: [summary("e1", { intendedApproach: "Relax validation rules", importantFilesOrComponents: ["payload.ts"], failureReason: "Serialized fields remain out of order" })], current: summary("e2", { intendedApproach: "Correct serialization order before validation", importantFilesOrComponents: ["payload.ts"] }), expected: "different" },
  { name: "F fragmented attempts", prior: [summary("f1", { problemBeingAddressed: "Provider timeout", intendedApproach: "Begin retry change" }), summary("f2", { problemBeingAddressed: "Provider timeout", intendedApproach: "Complete and test the retry change" })], current: summary("f3", { problemBeingAddressed: "Provider timeout", intendedApproach: "Raise retries again" }), expected: "repeat" },
  { name: "G insufficient evidence", prior: [summary("g1", { problemBeingAddressed: "Unknown", intendedApproach: "Unknown", actionsTaken: [], observedEvidence: [] })], current: summary("g2", { problemBeingAddressed: "Unknown", intendedApproach: "Try something", actionsTaken: [] }), expected: "partial", lowConfidence: true },
];

for (const scenario of cases) live(`live semantic evaluation: ${scenario.name}`, async () => {
  const provider = new AnthropicReasoningProvider({ apiKey: apiKey!, model: process.env.WATCHTOWER_REASONING_MODEL });
  const result = await new RepeatReasoningEngine({ provider, cache: new MemoryReasoningCache(), timeoutMs: 30_000 }).compare(scenario.prior, scenario.current);
  assert.equal(result.status, "evaluated", result.trace.errors.join("\n"));
  assert.equal(result.judgment?.classification, scenario.expected);
  if (scenario.lowConfidence) {
    assert.ok((result.judgment?.confidence ?? 1) < .5);
    assert.equal(result.shouldSurface, false);
  }
});
