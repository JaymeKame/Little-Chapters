import { createHash } from "node:crypto";
import type { Attempt, FailureEvidence, NormalizedEvent } from "../schema.ts";

type DetectorMatch = Omit<FailureEvidence, "id" | "attemptId" | "sourceEventId" | "rawText"> & { rawText?: string };
export type EvidenceDetector = (event: NormalizedEvent, text: string) => DetectorMatch[];

const patternDetector: EvidenceDetector = (event, text) => {
  const found: DetectorMatch[] = [];
  const add = (type: DetectorMatch["type"], re: RegExp, description: string, confidence = .9) => {
    const match = text.match(re); if (match) found.push({ type, rawText: match[0], description, confidence, severity: "error" });
  };
  add("test_failure", /(?:tests? failed|FAIL(?:ED)?\s|\d+ failing|failed tests?:)/i, "Test output reports a failure");
  add("build_failure", /(?:build failed|compilation failed|failed to compile|error TS\d+)/i, "Build or compilation failed");
  add("assertion_failure", /(?:AssertionError|assertion failed|expected .+ (?:to|but))/i, "An assertion failed");
  add("validation_failure", /(?:validation (?:error|failed)|invalid (?:request|payload|value)|422\b)/i, "Validation rejected the result");
  add("timeout", /(?:timed? out|timeout exceeded|ETIMEDOUT)/i, "Operation timed out");
  if (event.category === "assistant_message") add("assistant_acknowledgement", /(?:still fail(?:ing|s)?|did(?:n't| not) (?:fix|work)|same issue|failed validation)/i, "Assistant acknowledged the approach did not resolve the issue", .85);
  if (event.category === "user_message") add("user_correction", /(?:still broken|did(?:n't| not) work|same (?:problem|issue)|still fail(?:ing|s)?)/i, "User reported that the issue remains", .9);
  return found;
};

const structuralDetector: EvidenceDetector = (event, text) => {
  if (event.command?.exitStatus !== undefined && event.command.exitStatus !== 0)
    return [{ type: "non_zero_exit", rawText: text, description: `Command exited with status ${event.command.exitStatus}`, confidence: 1, severity: "error" }];
  if (event.explicitError)
    return [{ type: "tool_error", rawText: text, description: "Claude Code reported a tool-level error", confidence: 1, severity: "error" }];
  return [];
};

export function eventText(event: NormalizedEvent): string {
  return event.userMessage ?? event.assistantMessage ?? event.command?.stderr ?? event.command?.stdout ??
    (typeof event.toolResult?.content === "string" ? event.toolResult.content : JSON.stringify(event.toolResult?.content ?? ""));
}

export function extractFailureEvidence(attempt: Attempt, events: NormalizedEvent[], extraDetectors: EvidenceDetector[] = []): FailureEvidence[] {
  return events.filter((event) => attempt.sourceEventIds.includes(event.id)).flatMap((event) => {
    const text = eventText(event);
    return [structuralDetector, patternDetector, ...extraDetectors].flatMap((detector) => detector(event, text)).map((match, index) => ({
      ...match, rawText: match.rawText ?? text, attemptId: attempt.id, sourceEventId: event.id,
      id: createHash("sha256").update(`${attempt.id}:${event.id}:${match.type}:${index}`).digest("hex").slice(0, 24),
    }));
  });
}
