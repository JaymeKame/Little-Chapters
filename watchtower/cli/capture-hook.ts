import { homedir } from "node:os";
import { join } from "node:path";
import { captureClaudeHook } from "../capture/claude-hook.ts";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const payload = JSON.parse(input) as Record<string, unknown>;
const root = process.env.WATCHTOWER_DATA_DIR ?? join(homedir(), ".watchtower");
const result = await captureClaudeHook(payload, root);
process.stderr.write(`Watchtower captured ${result.transcriptEvents} transcript event(s) in ${result.rawPath}\n`);
