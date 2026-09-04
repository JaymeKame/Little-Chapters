import { appendFile, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { RawEnvelope } from "../schema.ts";

type OffsetState = { offset: number };

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function roleOf(payload: Record<string, unknown>): string | undefined {
  return text(payload.role) ?? (typeof payload.message === "object" && payload.message
    ? text((payload.message as Record<string, unknown>).role) : undefined);
}

function toolIdOf(payload: Record<string, unknown>): string | undefined {
  return text(payload.tool_use_id) ?? text(payload.toolUseId);
}

function envelope(payload: Record<string, unknown>, source: RawEnvelope["source"], sessionId: string): RawEnvelope {
  return {
    captureId: randomUUID(),
    capturedAt: new Date().toISOString(),
    sessionId,
    eventType: text(payload.hook_event_name) ?? text(payload.type) ?? "unknown",
    sourceRole: roleOf(payload),
    toolUseId: toolIdOf(payload),
    source,
    payload,
  };
}

async function appendEnvelope(path: string, value: RawEnvelope): Promise<void> {
  await appendFile(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function readOffset(path: string): Promise<OffsetState> {
  try { return JSON.parse(await readFile(path, "utf8")) as OffsetState; }
  catch { return { offset: 0 }; }
}

/** Copies only complete JSONL records. Offset updates are atomic, so repeated hooks are safe. */
async function captureTranscript(transcriptPath: string, rawPath: string, statePath: string, sessionId: string): Promise<number> {
  const state = await readOffset(statePath);
  const handle = await open(transcriptPath, "r");
  try {
    const stat = await handle.stat();
    const start = state.offset <= stat.size ? state.offset : 0;
    const buffer = Buffer.alloc(stat.size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lastNewline = buffer.lastIndexOf(10);
    if (lastNewline < 0) return 0;
    const complete = buffer.subarray(0, lastNewline + 1).toString("utf8");
    let count = 0;
    for (const line of complete.split("\n")) {
      if (!line.trim()) continue;
      try {
        const payload = JSON.parse(line) as Record<string, unknown>;
        await appendEnvelope(rawPath, envelope(payload, "transcript", sessionId));
        count++;
      } catch {
        // Preserve malformed structured input instead of silently discarding it.
        await appendEnvelope(rawPath, envelope({ type: "capture_parse_error", raw_line: line }, "transcript", sessionId));
      }
    }
    const next = JSON.stringify({ offset: start + lastNewline + 1 });
    const temp = `${statePath}.${process.pid}.tmp`;
    await writeFile(temp, next, { encoding: "utf8", mode: 0o600 });
    await rename(temp, statePath);
    return count;
  } finally { await handle.close(); }
}

export async function captureClaudeHook(payload: Record<string, unknown>, root: string): Promise<{ rawPath: string; transcriptEvents: number }> {
  const transcriptPath = text(payload.transcript_path);
  const sessionId = text(payload.session_id) ?? (transcriptPath
    ? createHash("sha256").update(transcriptPath).digest("hex").slice(0, 24) : randomUUID());
  const directory = join(root, "sessions", sessionId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const rawPath = join(directory, "raw.jsonl");
  await appendEnvelope(rawPath, envelope(payload, "hook", sessionId));
  let transcriptEvents = 0;
  if (transcriptPath) {
    try { transcriptEvents = await captureTranscript(transcriptPath, rawPath, join(directory, "transcript-offset.json"), sessionId); }
    catch (error) {
      await appendEnvelope(rawPath, envelope({ type: "capture_error", error: String(error), transcript_path: transcriptPath }, "hook", sessionId));
    }
  }
  return { rawPath, transcriptEvents };
}
