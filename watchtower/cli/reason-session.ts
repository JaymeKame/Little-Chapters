import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import type { AttemptSummary } from "../schema.ts";
import { FileReasoningCache } from "../reasoning/cache.ts";
import { reasonAboutRepeat } from "../reasoning/engine.ts";
import { AnthropicReasoningProvider } from "../reasoning/provider.ts";
import type { Sensitivity } from "../reasoning/types.ts";

const path = process.argv[2];
if (!path) throw new Error("Usage: npm run watchtower:reason -- <inspection.json>");
const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.WATCHTOWER_REASONING_MODEL;
if (!apiKey || !model) throw new Error("ANTHROPIC_API_KEY and WATCHTOWER_REASONING_MODEL are required");
const inspection = JSON.parse(await readFile(path, "utf8")) as { attempts: Array<{ summary?: AttemptSummary }> };
const summaries = inspection.attempts.flatMap((item) => item.summary ? [item.summary] : []);
if (summaries.length < 2) throw new Error("At least two attempt summaries are required");
const current = summaries.at(-1)!; const history = summaries.slice(0, -1);
const root = process.env.WATCHTOWER_DATA_DIR ?? join(homedir(), ".watchtower");
const trace = await reasonAboutRepeat(history, current, new AnthropicReasoningProvider(model, apiKey),
  new FileReasoningCache(join(root, "reasoning-cache")), { sensitivity: (process.env.WATCHTOWER_SENSITIVITY as Sensitivity) ?? "balanced" });
const output = join(dirname(path), `reasoning-${trace.comparisonId}.json`);
await writeFile(output, JSON.stringify(trace, null, 2), { encoding: "utf8", mode: 0o600 });
process.stdout.write(`${output}\n`);
