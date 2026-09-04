import { createHash } from "node:crypto";
import type { Attempt, NormalizedEvent } from "../schema.ts";
import { eventText } from "../evidence/extract.ts";

const intent = /\b(?:i(?:'ll| will| am going to)|let me|plan is|approach|instead|try(?:ing)? to|next,? i)\b/i;
const bad = /(?:fail|error|invalid|still broken|didn't work|\b422\b|non-zero|timed? out)/i;
const good = /(?:all tests pass|build succeeded|successfully|fixed|resolved|exit(?:ed)? (?:with )?(?:code )?0)/i;

/** A terse, non-prose follow-up message — a bare branch name, commit SHA,
 * file path, or URL — is how a real target user delivers a correction after
 * an agent's failed attempt. The natural-language correction regex misses
 * these entirely (verified against a live self-transcript). */
const pointerCorrection = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 200 || /\n/.test(trimmed)) return false;
  if (/^[A-Za-z0-9._\-\/]+$/.test(trimmed) && trimmed.includes("/")) return true; // branch or path segment
  if (/^[0-9a-f]{7,40}$/.test(trimmed)) return true; // commit SHA
  if (/^https?:\/\/\S+$/.test(trimmed)) return true; // URL
  if (/^\.{0,2}\/[^\s]+$/.test(trimmed)) return true; // relative or absolute path
  return false;
};

/** `successful_validation` must only fire on actual test/build/run command
 * output — not on `git show`, `git grep`, `cat`, or `ls`, whose stdout is
 * really file content or metadata that happens to contain "resolved" or
 * "successfully" as prose. A tool-name filter alone (Bash vs Read) is too
 * coarse: `git show src.ts` is Bash but is a file read in spirit. Match the
 * command string against the vocabularies of actual test/build/run drivers. */
const isExecutionCommand = (cmd: string): boolean =>
  /\b(?:npm (?:test|run|start)|pnpm (?:test|run)|yarn (?:test|run)|jest|vitest|mocha|pytest|python\s+-m\s+(?:pytest|unittest)|cargo (?:test|build|run)|go (?:test|build|run)|make|bazel|gradle|mvn|dotnet (?:test|build|run)|rspec|rake\s+test|node\s+--test)\b/i.test(cmd);

/** Structural evidence of failure inside a tool_result — targeted test/build/
 * assertion/validation-runner output patterns, NOT the loose `bad` word regex
 * that matches "fail"/"error" wherever they appear (including in user prompts
 * describing what they want fixed). */
const structuralFailureInToolResult = /(?:tests? failed|\d+ failing|\bFAIL(?:ED)?\s|failed tests?:|build failed|compilation failed|failed to compile|error TS\d+|AssertionError|assertion failed|validation (?:error|failed)|invalid (?:request|payload|value)|\b422\b|timed? out|ETIMEDOUT|non-zero exit|command not found|permission denied)/i;

/** Assistant self-acknowledgement of failure. In real agent debugging, most
 * "failure evidence" is conversational: the assistant realizing something
 * doesn't exist, isn't findable, or can't be done — not a test-runner exit
 * code. Targeted phrasing patterns so this doesn't degrade back into loose
 * word matching on prose. Verified against a live self-transcript's two
 * failed-then-retry sequences. */
const assistantFailureAck = /(?:doesn't exist|does not exist|isn't (?:in |available|possible|recoverable|there|anywhere)|is not (?:in |available|possible|recoverable)|not in (?:the |your |this )?(?:repo|tree|codebase|context|session|conversation)|couldn't (?:find|do|complete|reach|locate|resolve)|(?:i (?:can't|cannot|could not)) (?:find|do|complete|reach|locate|resolve)|unable to (?:find|do|complete|reach|locate|resolve)|no such|not recognized|not found|nowhere I('ve|\s+have) looked|failed to (?:find|open|read|complete|resolve))/i;

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
  // Track each tool_use's command string so a matching tool_result can be
  // gated on whether the underlying command was a real test/build/run driver.
  const toolUseCommand = new Map<string, string>();
  for (const event of events) {
    if (event.toolUse?.id && event.category === "command_execution") {
      toolUseCommand.set(event.toolUse.id, event.command?.command ?? "");
    }
    if (event.userMessage) {
      const um = event.userMessage;
      const naturalCorrection = active.some((e) => e.toolUse || e.command) &&
        /(?:still|instead|no,|didn't|try)/i.test(um);
      // Pointer patterns are strong on their own — no plausible first-turn
      // user prompt is just a branch name / SHA / path / URL. Fire whenever
      // the active list is non-empty (i.e., anything has happened in this
      // attempt), not just when tools have already run.
      const pointerRedirect = active.length > 0 && pointerCorrection(um);
      if (naturalCorrection || pointerRedirect) close("user_follow_up_or_correction");
      problem = um;
    }
    // Prior failure evidence: structural signals first (is_error, non-zero
    // exit, targeted tool_result failure patterns), then a targeted
    // assistant self-acknowledgement pattern for the conversational case
    // where the assistant realizes something can't be done. Never a loose
    // word match on user_message text or arbitrary prose — that let the
    // user's own prompt vocabulary ("outstanding failure", "if that fails")
    // fire priorFailure and produced bonus false closes.
    //
    // KNOWN LIMITATION (see WATCHTOWER_PHASES_1_5.md): the segmenter
    // operates on individual transcript events, not conversational turns.
    // A single assistant turn is emitted as multiple assistant_message
    // events across tool-call cycles, so a same-turn self-ack ("X doesn't
    // exist") followed by same-turn intent ("Let me try Y") triggers a
    // strategy_change close inside what is really one coherent reply,
    // over-fragmenting attempts. Fixing this needs parentUuid/turn-grouping
    // surfaced in the schema; deferred as Phase-6-adjacent architecture,
    // not a Phase-1-5 blocker. Over-fragmentation is a safer failure mode
    // for downstream reasoning to inherit than under-fragmentation.
    const priorFailure = active.some((e) =>
      e.explicitError ||
      (e.command?.exitStatus ?? 0) !== 0 ||
      (e.category === "tool_result" && structuralFailureInToolResult.test(eventText(e))) ||
      (e.category === "assistant_message" && assistantFailureAck.test(eventText(e))));
    if (event.assistantMessage && intent.test(event.assistantMessage) && priorFailure && active.some((e) => e.toolUse || e.command)) close("strategy_change_after_failure_evidence");
    active.push(event);
    if (event.category === "tool_result" && !event.explicitError && good.test(eventText(event))) {
      const cmd = event.toolResult?.toolUseId ? toolUseCommand.get(event.toolResult.toolUseId) : undefined;
      if (cmd && isExecutionCommand(cmd)) close("successful_validation");
    }
  }
  close("session_end");
  return attempts;
}
