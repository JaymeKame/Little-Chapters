/**
 * Types and accessors for content/stages.json.
 *
 * The stage file is the single source of truth for what a child at a given
 * stage is allowed to read. Everything downstream - the generator prompt, the
 * phonics validator, the parent SMS - reads from here.
 */

import stagesDoc from './stages.json';

export interface Grapheme {
  grapheme: string;
  phoneme: string;
  example: string;
  vowel: boolean;
}

export interface GeneratorPalette {
  nouns: string[];
  verbs: string[];
  adjectives: string[];
}

export interface Stage {
  id: number;
  label: string;
  focus: string;
  note: string;
  source_alignment: { ufli: string; letters_and_sounds: string };
  phonics: {
    new_graphemes: Grapheme[];
    suffixes_available: string[];
    max_syllables: number;
    max_consonant_cluster: number;
  };
  sight_words_introduced: string[];
  decodable_words_introduced: string[];
  example_words: string[];
  sentence_length: { min: number; max: number };
  generator_palette: GeneratorPalette;
  counts: {
    new_decodable: number;
    new_sight: number;
    cumulative_allowed: number;
  };
}

export interface SightWordProvenance {
  introduced_at_stage: number;
  list: string;
  becomes_decodable_at_stage: number | null;
  irregularity: string | null;
}

export interface StagesDoc {
  schema_version: string;
  generated: string;
  language: string;
  target_ages: string;
  vocabulary_model: 'cumulative';
  readme: Record<string, string>;
  sources: Array<{
    id: string;
    title: string;
    publisher: string;
    url: string;
    mirror?: string;
    used_for: string;
  }>;
  content_blocklist: string[];
  human_nouns: string[];
  sight_word_provenance: Record<string, SightWordProvenance>;
  stages: Stage[];
}

export const STAGES_DOC = stagesDoc as unknown as StagesDoc;
export const STAGES: readonly Stage[] = STAGES_DOC.stages;

export const MIN_STAGE = 1;
export const MAX_STAGE = STAGES.length;

export class UnknownStageError extends Error {
  constructor(id: number) {
    super(`No such stage: ${id}. Valid range is ${MIN_STAGE}-${MAX_STAGE}.`);
    this.name = 'UnknownStageError';
  }
}

export function getStage(id: number): Stage {
  const s = STAGES.find((x) => x.id === id);
  if (!s) throw new UnknownStageError(id);
  return s;
}

/** Clamp a stage id into the valid range. Used by the progression engine so a
 *  drop-back at stage 1 or an advance at stage 10 is a no-op rather than a throw. */
export function clampStage(id: number): number {
  return Math.min(MAX_STAGE, Math.max(MIN_STAGE, Math.round(id)));
}

// --- allowed-word sets -----------------------------------------------------
// Cumulative and immutable, so they are built once and cached.

const allowedCache = new Map<number, ReadonlySet<string>>();

/**
 * Every word a child at this stage is permitted to encounter: the union of
 * decodable and sight words introduced at stages 1..id.
 *
 * This is the set the phonics validator checks against. It is intentionally
 * wider than the generator palette - a child is never marked wrong for a word
 * the generator was allowed to produce.
 */
export function allowedWordsForStage(id: number): ReadonlySet<string> {
  const stage = clampStage(id);
  const hit = allowedCache.get(stage);
  if (hit) return hit;

  const set = new Set<string>();
  for (const s of STAGES) {
    if (s.id > stage) break;
    for (const w of s.decodable_words_introduced) set.add(w);
    for (const w of s.sight_words_introduced) set.add(w.toLowerCase());
  }
  const frozen: ReadonlySet<string> = set;
  allowedCache.set(stage, frozen);
  return frozen;
}

/** The curated subset the story generator may draw content words from.
 *  Already cumulative in the JSON. Excludes human nouns and blocklisted words. */
export function paletteForStage(id: number): GeneratorPalette {
  return getStage(clampStage(id)).generator_palette;
}

/**
 * Words from the next stage that may appear as a stretch. The stage file caps
 * this at 1-2 per story; enforcing the cap is the generator's job, not this
 * function's. Returns an empty array at the final stage.
 */
export function previewWordsForStage(id: number): string[] {
  const next = clampStage(id) + 1;
  if (next > MAX_STAGE) return [];
  const p = getStage(next).generator_palette;
  return [...p.nouns, ...p.verbs, ...p.adjectives].filter((w) =>
    getStage(next).decodable_words_introduced.includes(w),
  );
}

export const CONTENT_BLOCKLIST: ReadonlySet<string> = new Set(
  STAGES_DOC.content_blocklist,
);
export const HUMAN_NOUNS: ReadonlySet<string> = new Set(STAGES_DOC.human_nouns);

// --- tokenisation ----------------------------------------------------------

/**
 * Split a generated sentence into comparable word tokens.
 *
 * Strips terminal punctuation and possessives, keeps internal hyphens as word
 * breaks, lowercases. Apostrophes are preserved so contractions surface as
 * violations rather than being silently split into valid halves - no stage in
 * this file teaches contractions.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[\s\-—]+/)
    .map((t) => t.replace(/^[^a-z']+|[^a-z']+$/g, ''))
    .filter(Boolean);
}
