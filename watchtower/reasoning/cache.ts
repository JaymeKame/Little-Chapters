import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ReasoningTrace } from "./types.ts";

export interface ReasoningCache {
  get(id: string): Promise<ReasoningTrace | null>;
  put(trace: ReasoningTrace): Promise<void>;
}

export class FileReasoningCache implements ReasoningCache {
  private readonly directory: string;
  constructor(directory: string) { this.directory = directory; }
  async get(id: string): Promise<ReasoningTrace | null> {
    try { return JSON.parse(await readFile(join(this.directory, `${id}.json`), "utf8")) as ReasoningTrace; }
    catch { return null; }
  }
  async put(trace: ReasoningTrace): Promise<void> {
    const path = join(this.directory, `${trace.comparisonId}.json`);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(trace, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  }
}

export class MemoryReasoningCache implements ReasoningCache {
  private readonly values = new Map<string, ReasoningTrace>();
  async get(id: string) { return this.values.get(id) ?? null; }
  async put(trace: ReasoningTrace) { this.values.set(trace.comparisonId, trace); }
}
