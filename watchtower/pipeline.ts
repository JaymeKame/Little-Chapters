import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FailureEvidence, RawEnvelope } from "./schema.ts";
import { normalizeClaudeEvent } from "./normalize/claude.ts";
import { segmentAttempts } from "./segment/heuristic.ts";
import { extractFailureEvidence } from "./evidence/extract.ts";
import { DeterministicAttemptSummarizer } from "./summarize/deterministic.ts";

export async function processSession(rawPath: string, outputDirectory = dirname(rawPath)) {
  const lines = (await readFile(rawPath, "utf8")).split("\n").filter(Boolean);
  const rawEvents = lines.map((line) => JSON.parse(line) as RawEnvelope);
  const normalizedEvents = rawEvents.flatMap(normalizeClaudeEvent).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const attempts = segmentAttempts(normalizedEvents);
  const failureEvidence: FailureEvidence[] = attempts.flatMap((attempt) => extractFailureEvidence(attempt, normalizedEvents));
  const summarizer = new DeterministicAttemptSummarizer();
  const summaries = await Promise.all(attempts.map((attempt) => summarizer.summarize(attempt, failureEvidence.filter((e) => e.attemptId === attempt.id))));
  const inspection = { generatedAt: new Date().toISOString(), rawEvents, normalizedEvents,
    attempts: attempts.map((attempt) => ({ ...attempt, activeAttemptEventIds: attempt.sourceEventIds,
      failureEvidence: failureEvidence.filter((e) => e.attemptId === attempt.id),
      summary: summaries.find((s) => s.attemptId === attempt.id) })) };
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, "inspection.json");
  await writeFile(outputPath, JSON.stringify(inspection, null, 2), { encoding: "utf8", mode: 0o600 });
  return { outputPath, ...inspection };
}
