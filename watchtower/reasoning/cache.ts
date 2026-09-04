import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ComparisonTrace } from "./types.ts";

export interface ReasoningCache {
  get(id: string): Promise<ComparisonTrace | null>;
  set(id: string, trace: ComparisonTrace): Promise<void>;
}

export class FileReasoningCache implements ReasoningCache {
  private readonly directory: string;
  constructor(directory: string) { this.directory = directory; }
  async get(id: string): Promise<ComparisonTrace | null> {
    try { return JSON.parse(await readFile(join(this.directory, `${id}.json`), "utf8")) as ComparisonTrace; }
    catch { return null; }
  }
  async set(id: string, trace: ComparisonTrace): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = join(this.directory, `${id}.json`); const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(trace, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temp, target);
  }
}

export class MemoryReasoningCache implements ReasoningCache {
  private values = new Map<string, ComparisonTrace>();
  async get(id: string) { return this.values.get(id) ?? null; }
  async set(id: string, trace: ComparisonTrace) { this.values.set(id, trace); }
}
