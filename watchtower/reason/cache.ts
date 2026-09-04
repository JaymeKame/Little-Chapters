import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ReasoningTrace } from "./types.ts";

export interface ComparisonCache { get(id: string): Promise<ReasoningTrace | undefined>; set(id: string, trace: ReasoningTrace): Promise<void>; }

export class MemoryComparisonCache implements ComparisonCache {
  private readonly values = new Map<string, ReasoningTrace>();
  async get(id: string) { return this.values.get(id); }
  async set(id: string, trace: ReasoningTrace) { this.values.set(id, trace); }
}

/** Owner-only local persistence prevents duplicate calls and alerts across CLI processes. */
export class FileComparisonCache implements ComparisonCache {
  private readonly path: string;
  constructor(path: string) { this.path = path; }
  private async read(): Promise<Record<string, ReasoningTrace>> {
    try { return JSON.parse(await readFile(this.path, "utf8")) as Record<string, ReasoningTrace>; }
    catch { return {}; }
  }
  async get(id: string) { return (await this.read())[id]; }
  async set(id: string, trace: ReasoningTrace) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const values = await this.read(); values[id] = trace;
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(values), { mode: 0o600 });
    await rename(temporary, this.path);
  }
}
