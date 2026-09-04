import { homedir } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AttemptSummary } from "../schema.ts";
import { FileReasoningCache } from "../reasoning/cache.ts";
import { RepeatReasoningEngine } from "../reasoning/engine.ts";
import { AnthropicReasoningProvider } from "../reasoning/provider-anthropic.ts";
import type { Sensitivity } from "../reasoning/types.ts";

const path = process.argv[2];
if (!path) throw new Error("Usage: npm run watchtower:reason -- <summaries.json> [cautious|balanced|aggressive]");
const apiKey = process.env.ANTHROPIC_API_KEY;
const document = JSON.parse(await readFile(path, "utf8")) as unknown;
const summaries = (Array.isArray(document) ? document : typeof document === "object" && document &&
  Array.isArray((document as { attempts?: unknown }).attempts)
  ? (document as { attempts: Array<{ summary?: Partial<AttemptSummary> }> }).attempts.map((item) => item.summary).filter(Boolean)
  : []) as Array<Partial<AttemptSummary>>;
if (summaries.length < 2) throw new Error("At least two attempt summaries are required");
const cacheRoot = process.env.WATCHTOWER_DATA_DIR ?? join(homedir(), ".watchtower");
const provider = apiKey ? new AnthropicReasoningProvider({ apiKey, model: process.env.WATCHTOWER_REASONING_MODEL,
  inputCostPerMillion: Number(process.env.WATCHTOWER_INPUT_COST_PER_MILLION) || undefined,
  outputCostPerMillion: Number(process.env.WATCHTOWER_OUTPUT_COST_PER_MILLION) || undefined }) : {
    model: process.env.WATCHTOWER_REASONING_MODEL ?? "provider-not-configured",
    async complete(): Promise<never> { throw new Error("ANTHROPIC_API_KEY is not configured; observation continues without a judgment"); },
  };
const engine = new RepeatReasoningEngine({ provider, cache: new FileReasoningCache(join(cacheRoot, "reasoning-cache")) });
const results = [];
for (let index = 1; index < summaries.length; index++) {
  results.push(await engine.compare(summaries.slice(0, index), summaries[index],
    { sensitivity: (process.argv[3] as Sensitivity | undefined) ?? "balanced" }));
}
const output = `${path}.reasoning.json`;
await writeFile(output, JSON.stringify({ generatedAt: new Date().toISOString(), comparisons: results }, null, 2), { encoding: "utf8", mode: 0o600 });
process.stdout.write(`${output}\n`);
