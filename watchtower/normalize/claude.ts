import { createHash } from "node:crypto";
import type { NormalizedEvent, RawEnvelope } from "../schema.ts";

const string = (v: unknown): string | undefined => typeof v === "string" ? v : undefined;
const object = (v: unknown): Record<string, unknown> => typeof v === "object" && v !== null ? v as Record<string, unknown> : {};

/** Extract any text-bearing content into a body string — reads either `.text`
 * (text blocks) or `.content` (tool_result blocks). Used for pulling tool
 * output bodies where any embedded string is welcome. */
const contentText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => string(object(item).text) ?? string(object(item).content) ?? "").filter(Boolean).join("\n");
};

/** Extract only genuinely author-written text. Ignores tool_result / tool_use
 * blocks: verified against a live Claude Code session, a user turn whose only
 * content is a runtime-injected tool_result would otherwise double-emit as a
 * `user_message` (with tool output stringified as if the user had typed it)
 * AND as per-block tool_result events. Emit the tool_result once, not twice. */
const authorProse = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => {
    const block = object(item);
    return block.type === "text" ? (string(block.text) ?? "") : "";
  }).filter(Boolean).join("\n");
};

function base(raw: RawEnvelope, suffix = "0"): NormalizedEvent {
  const id = createHash("sha256").update(`${raw.captureId}:${suffix}`).digest("hex").slice(0, 24);
  return { id, sessionId: raw.sessionId, timestamp: string(raw.payload.timestamp) ?? raw.capturedAt,
    category: "unknown", sourceRole: raw.sourceRole, explicitError: false, rawSource: raw };
}

function toolEvent(raw: RawEnvelope, block: Record<string, unknown>, index: number): NormalizedEvent {
  const result = base(raw, String(index));
  if (block.type === "tool_use") {
    const name = string(block.name) ?? "unknown";
    const input = object(block.input);
    result.category = ["Bash", "bash", "shell"].includes(name) ? "command_execution"
      : ["Edit", "Write", "NotebookEdit"].includes(name) ? "file_edit" : "tool_use";
    result.toolUse = { id: string(block.id), name, input: block.input };
    if (result.category === "command_execution") result.command = { command: string(input.command) ?? "" };
    if (result.category === "file_edit") result.fileEdits = [string(input.file_path) ?? string(input.path) ?? ""].filter(Boolean);
  } else {
    result.category = "tool_result";
    result.toolResult = { toolUseId: string(block.tool_use_id), content: block.content };
    result.explicitError = block.is_error === true;
    const details = object(block.content);
    const body = contentText(block.content) || string(details.stdout) || "";
    const stderr = string(block.stderr) ?? string(details.stderr);
    const candidateExit = block.exit_code ?? details.exit_code ?? details.exitCode;
    const exit = typeof candidateExit === "number" ? candidateExit : undefined;
    if (body || stderr || exit !== undefined) result.command = { command: "", stdout: body, stderr, exitStatus: exit };
  }
  return result;
}

export function normalizeClaudeEvent(raw: RawEnvelope): NormalizedEvent[] {
  const payload = raw.payload;
  const message = object(payload.message);
  const role = string(message.role) ?? string(payload.role) ?? raw.sourceRole;
  const content = message.content ?? payload.content;
  const blocks = Array.isArray(content) ? content.map(object) : [];
  const events: NormalizedEvent[] = [];
  const prose = authorProse(content);
  if (role === "user" && prose) events.push({ ...base(raw, "message"), category: "user_message", sourceRole: role, userMessage: prose });
  if (role === "assistant" && prose) events.push({ ...base(raw, "message"), category: "assistant_message", sourceRole: role, assistantMessage: prose });
  blocks.forEach((block, index) => {
    if (block.type === "tool_use" || block.type === "tool_result") events.push(toolEvent(raw, block, index));
  });
  if (events.length) return events;

  const hook = string(payload.hook_event_name);
  if (hook === "PreToolUse" || hook === "PostToolUse" || hook === "PostToolUseFailure") {
    const result = base(raw);
    const name = string(payload.tool_name) ?? "unknown";
    const input = object(payload.tool_input);
    result.category = hook === "PreToolUse" ? (["Bash", "bash"].includes(name) ? "command_execution" : "tool_use") : "tool_result";
    // Verified against a live Claude Code session: PostToolUseFailure does NOT
    // fire for non-zero-exit commands — a failed Bash arrives as an ordinary
    // PostToolUse, and the hook payload exposes neither `is_error` nor
    // `exit_code` on tool_response. We do not fabricate a hook-level failure
    // signal from stderr heuristics. Reliable failure detection uses the
    // transcript-side tool_result.is_error and downstream evidence extraction
    // over the raw response preserved in toolResult.content. The
    // PostToolUseFailure check is kept defensively for a future harness that
    // does emit it.
    result.explicitError = hook === "PostToolUseFailure";
    result.toolUse = hook === "PreToolUse" ? { id: string(payload.tool_use_id), name, input: payload.tool_input } : undefined;
    result.toolResult = hook !== "PreToolUse" ? { toolUseId: string(payload.tool_use_id), content: payload.tool_response ?? payload.error } : undefined;
    if (result.category === "command_execution") result.command = { command: string(input.command) ?? "" };
    if (hook !== "PreToolUse") {
      const response = object(payload.tool_response);
      result.command = {
        command: string(input.command) ?? "",
        stdout: string(response.stdout) ?? (typeof payload.tool_response === "string" ? payload.tool_response : undefined),
        stderr: string(response.stderr) ?? string(payload.error),
        // Exit status is not exposed by the observed Claude Code hook schema
        // (tool_response has stdout/stderr/interrupted/isImage/noOutputExpected,
        // no exit_code). Leave undefined; the raw response is retained in
        // toolResult.content for downstream extraction.
        exitStatus: undefined,
      };
    }
    return [result];
  }
  return [{ ...base(raw), category: hook ? "session" : raw.eventType === "capture_error" ? "error" : "unknown",
    explicitError: raw.eventType.includes("error") }];
}
