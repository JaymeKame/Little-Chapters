import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AttemptSummary } from "../schema.ts";
import { FileComparisonCache } from "../reason/cache.ts";
import { RepeatReasoningEngine } from "../reason/engine.ts";
import { OpenAIResponsesProvider } from "../reason/provider.ts";
import type { Sensitivity } from "../reason/types.ts";

const path = process.argv[2];
if (!path) throw new Error("Usage: npm run watchtower:reason -- <summaries.json> [cautious|balanced|aggressive]");
const summaries = JSON.parse(await readFile(path, "utf8")) as AttemptSummary[];
const current = summaries.at(-1); if (!current) throw new Error("No attempt summaries supplied");
const apiKey = process.env.OPENAI_API_KEY; if (!apiKey) throw new Error("OPENAI_API_KEY is required");
const provider = new OpenAIResponsesProvider({ apiKey, model: process.env.WATCHTOWER_REASONING_MODEL,
  baseUrl: process.env.OPENAI_BASE_URL, inputUsdPerMillion: Number(process.env.WATCHTOWER_INPUT_USD_PER_MILLION) || undefined,
  outputUsdPerMillion: Number(process.env.WATCHTOWER_OUTPUT_USD_PER_MILLION) || undefined });
const cachePath = process.env.WATCHTOWER_REASONING_CACHE ?? join(homedir(), ".watchtower", "reasoning-cache.json");
const result = await new RepeatReasoningEngine({ provider, cache: new FileComparisonCache(cachePath) }).compare(summaries.slice(0, -1), current, (process.argv[3] as Sensitivity | undefined) ?? "balanced");
const output = `${path}.reasoning.json`;
await writeFile(output, JSON.stringify(result, null, 2), { mode: 0o600 });
process.stdout.write(`${output}\n`);
