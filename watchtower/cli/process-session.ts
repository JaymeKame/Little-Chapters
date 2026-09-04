import { processSession } from "../pipeline.ts";

const path = process.argv[2];
if (!path) throw new Error("Usage: npm run watchtower:process -- <path/to/raw.jsonl>");
const result = await processSession(path);
process.stdout.write(`${result.outputPath}\n`);
