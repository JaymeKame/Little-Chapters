import { createHash } from "node:crypto";
import type { Attempt, NormalizedEvent } from "../schema.ts";
import { eventText } from "../evidence/extract.ts";

const intent = /\b(?:i(?:'ll| will| am going to)|let me|plan is|approach|instead|try(?:ing)? to|next,? i)\b/i;
const bad = /(?:fail|error|invalid|still broken|didn't work|\b422\b|non-zero|timed? out)/i;
const good = /(?:all tests pass|build succeeded|successfully|fixed|resolved|exit(?:ed)? (?:with )?(?:code )?0)/i;

function make(events: NormalizedEvent[], problem: string, boundaryReason: string): Attempt {
  const text = events.map(eventText).filter(Boolean);
  const approach = events.find((event) => event.assistantMessage && intent.test(event.assistantMessage))?.assistantMessage ?? "No explicit approach statement observed";
  const actions = events.filter((e) => e.toolUse).map((e) => `${e.toolUse!.name}: ${JSON.stringify(e.toolUse!.input)}`);
  const commands = events.map((e) => e.command?.command).filter((v): v is string => Boolean(v));
  const files = [...new Set(events.flatMap((e) => e.fileEdits ?? []))];
  const evidence = text.filter((value) => bad.test(value) || good.test(value));
  const failed = events.some((e) => e.explicitError || (e.command?.exitStatus ?? 0) !== 0) || evidence.some((v) => bad.test(v));
  const succeeded = !failed && evidence.some((v) => good.test(v));
  const first = events[0]; const last = events.at(-1)!;
  const id = createHash("sha256").update(`${first.sessionId}:${first.id}`).digest("hex").slice(0, 24);
  return { id, sessionId: first.sessionId, startTimestamp: first.timestamp, endTimestamp: last.timestamp,
    sourceEventIds: events.map((e) => e.id), problem, intendedApproach: approach, actionsTaken: actions,
    filesTouched: files, commandsRun: commands, evidenceObserved: evidence,
    inferredOutcome: failed ? "failure" : succeeded ? "success" : "unresolved", boundaryReason,
    segmentationConfidence: boundaryReason === "session_end" ? .65 : .8 };
}

export function segmentAttempts(events: NormalizedEvent[]): Attempt[] {
  const attempts: Attempt[] = []; let active: NormalizedEvent[] = []; let problem = "Problem not explicitly stated";
  const close = (reason: string) => { if (active.length) attempts.push(make(active, problem, reason)); active = []; };
  for (const event of events) {
    if (event.userMessage) {
      if (active.some((e) => e.toolUse || e.command) && /(?:still|instead|no,|didn't|try)/i.test(event.userMessage)) close("user_follow_up_or_correction");
      problem = event.userMessage;
    }
    const priorFailure = active.some((e) => e.explicitError || bad.test(eventText(e)) || (e.command?.exitStatus ?? 0) !== 0);
    if (event.assistantMessage && intent.test(event.assistantMessage) && priorFailure && active.some((e) => e.toolUse || e.command)) close("strategy_change_after_failure_evidence");
    active.push(event);
    if (event.category === "tool_result" && !event.explicitError && good.test(eventText(event))) close("successful_validation");
  }
  close("session_end");
  return attempts;
}
