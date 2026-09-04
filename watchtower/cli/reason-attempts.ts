import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AttemptSummary } from "../schema.ts";
import { FileReasoningCache } from "../reasoning/cache.ts";
import { RepeatReasoner } from "../reasoning/engine.ts";
import { AnthropicReasoningProvider } from "../reasoning/provider-anthropic.ts";
import type { ReasoningProvider } from "../reasoning/types.ts";

const path = process.argv[2];
if (!path) throw new Error("Usage: npm run watchtower:reason -- <summaries.json>");
const apiKey = process.env.ANTHROPIC_API_KEY;
const summaries = JSON.parse(await readFile(path, "utf8")) as AttemptSummary[];
if (summaries.length < 2) throw new Error("At least two attempt summaries are required");
const model = process.env.WATCHTOWER_REASONING_MODEL ?? "claude-sonnet-4-20250514";
const unavailableProvider: ReasoningProvider = { name: "unavailable", async complete() { throw new Error("ANTHROPIC_API_KEY is not configured"); } };
const provider = apiKey ? new AnthropicReasoningProvider({ apiKey }) : unavailableProvider;
const reasoner = new RepeatReasoner({ provider, model,
  cache: new FileReasoningCache(process.env.WATCHTOWER_REASONING_DIR ?? join(homedir(), ".watchtower", "reasoning")) });
const result = await reasoner.compare(summaries.slice(0, -1), summaries.at(-1)!);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
