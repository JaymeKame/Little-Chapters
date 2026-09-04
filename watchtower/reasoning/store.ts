import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ComparisonTrace } from "./types.ts";

export interface ReasoningStore {
  get(comparisonId: string): Promise<ComparisonTrace | null>;
  put(trace: ComparisonTrace): Promise<void>;
}

export class MemoryReasoningStore implements ReasoningStore {
  private values = new Map<string, ComparisonTrace>();
  async get(id: string) { return this.values.get(id) ?? null; }
  async put(trace: ComparisonTrace) { this.values.set(trace.comparisonId, trace); }
}

export class FileReasoningStore implements ReasoningStore {
  private readonly directory: string;
  constructor(directory: string) { this.directory = directory; }
  async get(id: string): Promise<ComparisonTrace | null> {
    try { return JSON.parse(await readFile(join(this.directory, `${id}.json`), "utf8")) as ComparisonTrace; }
    catch { return null; }
  }
  async put(trace: ComparisonTrace): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(join(this.directory, `${trace.comparisonId}.json`), JSON.stringify(trace, null, 2), { mode: 0o600 });
  }
}
