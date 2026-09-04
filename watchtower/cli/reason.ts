import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { AttemptSummary } from "../schema.ts";
import { FileJudgmentCache } from "../reasoning/cache.ts";
import { RepeatReasoningEngine } from "../reasoning/engine.ts";
import { AnthropicReasoningProvider } from "../reasoning/provider.ts";
import type { Sensitivity } from "../reasoning/types.ts";

const path = process.argv[2];
if (!path) throw new Error("Usage: npm run watchtower:reason -- <summaries.json>");
const summaries = JSON.parse(await readFile(path, "utf8")) as AttemptSummary[];
if (summaries.length < 2) throw new Error("At least two attempt summaries are required");
const root = process.env.WATCHTOWER_DATA_DIR ?? join(homedir(), ".watchtower");
const engine = new RepeatReasoningEngine(new AnthropicReasoningProvider(), {
  sensitivity: (process.env.WATCHTOWER_SENSITIVITY as Sensitivity | undefined) ?? "balanced",
  cache: new FileJudgmentCache(join(root, "reasoning-cache.json")),
  tracePath: join(root, "reasoning-traces.jsonl"),
  inputCostPerMillionTokens: process.env.WATCHTOWER_INPUT_COST_PER_MILLION ? Number(process.env.WATCHTOWER_INPUT_COST_PER_MILLION) : undefined,
  outputCostPerMillionTokens: process.env.WATCHTOWER_OUTPUT_COST_PER_MILLION ? Number(process.env.WATCHTOWER_OUTPUT_COST_PER_MILLION) : undefined,
});
const result = await engine.compare(summaries.slice(0, -1), summaries.at(-1)!);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
// Advisory only: provider failures deliberately do not produce a non-zero exit code.
