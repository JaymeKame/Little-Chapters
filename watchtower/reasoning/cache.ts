import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ComparisonTrace, RepeatJudgment } from "./types.ts";

export type CachedComparison = { judgment: RepeatJudgment; trace: ComparisonTrace };
export interface JudgmentCache {
  get(id: string): Promise<CachedComparison | undefined>;
  put(id: string, value: CachedComparison): Promise<void>;
}

export class MemoryJudgmentCache implements JudgmentCache {
  private readonly values = new Map<string, CachedComparison>();
  async get(id: string) { return this.values.get(id); }
  async put(id: string, value: CachedComparison) { this.values.set(id, value); }
}

export class FileJudgmentCache implements JudgmentCache {
  private readonly path: string;
  constructor(path: string) { this.path = path; }
  private async all(): Promise<Record<string, CachedComparison>> {
    try { return JSON.parse(await readFile(this.path, "utf8")) as Record<string, CachedComparison>; }
    catch { return {}; }
  }
  async get(id: string) { return (await this.all())[id]; }
  async put(id: string, value: CachedComparison) {
    const values = await this.all(); values[id] = value;
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(values, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.path);
  }
}
