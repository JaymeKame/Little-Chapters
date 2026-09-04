import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ComparisonTrace } from "./types.ts";

export interface ReasoningStore {
  get(comparisonId: string): Promise<ComparisonTrace | undefined>;
  put(trace: ComparisonTrace): Promise<void>;
}

export class MemoryReasoningStore implements ReasoningStore {
  private readonly values = new Map<string, ComparisonTrace>();
  async get(id: string) { return this.values.get(id); }
  async put(trace: ComparisonTrace) { this.values.set(trace.comparisonId, trace); }
}

export class JsonFileReasoningStore implements ReasoningStore {
  private readonly path: string;
  constructor(path: string) { this.path = path; }
  private async all(): Promise<Record<string, ComparisonTrace>> {
    try { return JSON.parse(await readFile(this.path, "utf8")) as Record<string, ComparisonTrace>; }
    catch { return {}; }
  }
  async get(id: string) { return (await this.all())[id]; }
  async put(trace: ComparisonTrace) {
    const values = await this.all(); values[trace.comparisonId] = trace;
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temp = `${this.path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(values, null, 2), { mode: 0o600 });
    await rename(temp, this.path);
  }
}
