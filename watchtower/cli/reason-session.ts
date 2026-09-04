import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AttemptSummary } from "../schema.ts";
import { RepeatReasoningEngine } from "../reasoning/engine.ts";
import { OpenAIResponsesReasoningProvider } from "../reasoning/provider.ts";
import { FileReasoningStore } from "../reasoning/store.ts";
import type { Sensitivity } from "../reasoning/types.ts";

const inspectionPath = process.argv[2];
if (!inspectionPath) throw new Error("Usage: npm run watchtower:reason -- <inspection.json> [cautious|balanced|aggressive]");
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
const inspection = JSON.parse(await readFile(inspectionPath, "utf8")) as { attempts: Array<{ summary?: AttemptSummary }> };
const summaries = inspection.attempts.map((item) => item.summary).filter((item): item is AttemptSummary => Boolean(item));
const current = summaries.at(-1); if (!current) throw new Error("No attempt summaries found");
const sensitivity = (process.argv[3] ?? "balanced") as Sensitivity;
const provider = new OpenAIResponsesReasoningProvider({ apiKey: process.env.OPENAI_API_KEY, model: process.env.WATCHTOWER_REASONING_MODEL });
const engine = new RepeatReasoningEngine({ provider, store: new FileReasoningStore(join(dirname(inspectionPath), "reasoning")),
  inputCostPerMillionTokens: optionalNumber(process.env.WATCHTOWER_INPUT_COST_PER_MILLION),
  outputCostPerMillionTokens: optionalNumber(process.env.WATCHTOWER_OUTPUT_COST_PER_MILLION) });
process.stdout.write(`${JSON.stringify(await engine.compare(summaries.slice(0, -1), current, sensitivity), null, 2)}\n`);

function optionalNumber(value: string | undefined): number | undefined { return value === undefined ? undefined : Number(value); }
