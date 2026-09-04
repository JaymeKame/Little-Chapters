import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ComparisonDebugRecord } from "./types.ts";

export interface ReasoningCache {
  get(id: string): Promise<ComparisonDebugRecord | null>;
  set(id: string, record: ComparisonDebugRecord): Promise<void>;
}

export class MemoryReasoningCache implements ReasoningCache {
  private values = new Map<string, ComparisonDebugRecord>();
  async get(id: string) { return this.values.get(id) ?? null; }
  async set(id: string, record: ComparisonDebugRecord) { this.values.set(id, record); }
}

export class FileReasoningCache implements ReasoningCache {
  private readonly directory: string;
  constructor(directory: string) { this.directory = directory; }
  private path(id: string) { return join(this.directory, `${id}.json`); }
  async get(id: string) {
    try { return JSON.parse(await readFile(this.path(id), "utf8")) as ComparisonDebugRecord; }
    catch { return null; }
  }
  async set(id: string, record: ComparisonDebugRecord) {
    const path = this.path(id); await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(record, null, 2), { mode: 0o600 });
    await rename(temp, path);
  }
}
