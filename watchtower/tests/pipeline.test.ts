import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureClaudeHook } from "../capture/claude-hook.ts";
import { processSession } from "../pipeline.ts";

test("captures incremental transcript and processes all five layers", async () => {
  const root = await mkdtemp(join(tmpdir(), "watchtower-"));
  const transcript = join(root, "claude.jsonl");
  const records = [
    { type: "user", timestamp: "2026-09-04T10:00:00.000Z", message: { role: "user", content: "Fix payload validation" } },
    { type: "assistant", timestamp: "2026-09-04T10:00:01.000Z", message: { role: "assistant", content: [{ type: "text", text: "I'll increase the retry count." }, { type: "tool_use", id: "t1", name: "Edit", input: { file_path: "api/client.ts" } }] } },
    { type: "assistant", timestamp: "2026-09-04T10:00:02.000Z", message: { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "npm test" } }] } },
    { type: "user", timestamp: "2026-09-04T10:00:03.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "2 tests failed: validation error 422", is_error: false }] } },
    { type: "assistant", timestamp: "2026-09-04T10:00:04.000Z", message: { role: "assistant", content: "That is still failing. Instead, I'll repair payload generation." } },
    { type: "assistant", timestamp: "2026-09-04T10:00:05.000Z", message: { role: "assistant", content: [{ type: "tool_use", id: "t3", name: "Edit", input: { file_path: "api/payload.ts" } }] } },
  ];
  await writeFile(transcript, `${records.slice(0, 4).map((record) => JSON.stringify(record)).join("\n")}\n`);
  const hook = { session_id: "real-shape-session", transcript_path: transcript, hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: "t2", tool_response: "2 tests failed", timestamp: "2026-09-04T10:00:03.100Z" };
  const first = await captureClaudeHook(hook, root);
  assert.equal(first.transcriptEvents, 4);
  await writeFile(transcript, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  const second = await captureClaudeHook({ ...hook, hook_event_name: "Stop" }, root);
  assert.equal(second.transcriptEvents, 2);
  const result = await processSession(second.rawPath);
  assert.ok(result.normalizedEvents.some((event) => event.category === "file_edit"));
  assert.ok(result.normalizedEvents.some((event) => event.category === "command_execution"));
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].boundaryReason, "strategy_change_after_failure_evidence");
  const semantic = result.attempts[0].failureEvidence.find((item) => item.type === "test_failure");
  assert.ok(semantic);
  assert.equal(result.normalizedEvents.find((e) => e.id === semantic.sourceEventId)?.explicitError, false);
  assert.equal(result.attempts[0].summary?.inferredOutcome, "failure");
  assert.doesNotReject(() => readFile(result.outputPath, "utf8"));
});
