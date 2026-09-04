import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AttemptSummary } from "../schema.ts";
import { AnthropicReasoningProvider } from "../reasoning/anthropic-provider.ts";
import { RepeatReasoningEngine } from "../reasoning/engine.ts";

const path = process.argv[2];
if (!path) throw new Error("Usage: npm run watchtower:reason -- <inspection.json>");
const inspection = JSON.parse(await readFile(path, "utf8")) as { attempts: Array<{ summary?: AttemptSummary }> };
const summaries = inspection.attempts.map((attempt) => attempt.summary).filter((summary): summary is AttemptSummary => Boolean(summary));
const engine = new RepeatReasoningEngine(new AnthropicReasoningProvider(), { debugJsonlPath: join(dirname(path), "reasoning.jsonl") });
const results = [];
for (let index = 1; index < summaries.length; index++) results.push(await engine.compare(summaries.slice(0, index), summaries[index]));
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
