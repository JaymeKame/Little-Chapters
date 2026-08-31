/**
 * Session composition (correction sprint Sections 15-20).
 *
 * The Daily Adventure has a stable literacy/story spine — welcome, reading
 * clusters, ending — but the mechanic layer between reads is composed, not
 * hard-coded. The spine is still fixed (three interaction slots between four
 * reading clusters); the sequence of mechanics filling those slots varies day
 * to day, ordered by anti-repetition, mechanic-appropriateness for the
 * chapter's content, and a deterministic tie-break so a given chapter+seed
 * yields the same plan on re-mount.
 *
 * Not a recommendation engine. Not random. A small set of authored candidate
 * sequences, ranked deterministically, with the last N sessions' plans held
 * in localStorage as anti-repetition memory. This keeps the routine varied
 * without inventing new mechanics.
 */

export type MechanicKind = 'sound-hunt' | 'find-in-scene' | 'prediction' | 'word-builder';

/** Authored candidate sequences. Length is always 3 (one mechanic per
 *  interaction slot in the current spine). No sequence is a mere rotation of
 *  another — each represents a distinct pedagogical shape:
 *
 *    A "sound-first":       phonics → visual discovery → assembly
 *    B "sound-first-quiet": phonics → prediction       → assembly
 *    C "prediction-open":   prediction → phonics       → assembly
 *    D "assembly-middle":   phonics → assembly         → visual
 *    E "assembly-open":     assembly → phonics         → prediction
 *    F "visual-open":       visual → phonics           → assembly
 *    G "quiet-day":         phonics → visual           → prediction (no build)
 *    H "gentle-mix":        prediction → visual        → assembly (no phonics)
 *
 *  G and H are rest-day shapes: not every day must include every mechanic.
 *  The ranker will still lean toward including a literacy mechanic every day. */
export const CANDIDATE_SEQUENCES: readonly MechanicKind[][] = [
  ['sound-hunt', 'find-in-scene', 'word-builder'],
  ['sound-hunt', 'prediction', 'word-builder'],
  ['prediction', 'sound-hunt', 'word-builder'],
  ['sound-hunt', 'word-builder', 'find-in-scene'],
  ['word-builder', 'sound-hunt', 'prediction'],
  ['find-in-scene', 'sound-hunt', 'word-builder'],
  ['sound-hunt', 'find-in-scene', 'prediction'],
  ['prediction', 'find-in-scene', 'word-builder'],
];

export interface CompositionInputs {
  chapterId: string;
  /** Which mechanics have valid content in this chapter. */
  available: Record<MechanicKind, boolean>;
  /** Most-recent sessions first — [0] is yesterday, [1] is the day before, etc. */
  recent: MechanicKind[][];
}

export interface CompositionResult {
  sequence: MechanicKind[];
  reason: string;
}

const RECENT_HISTORY_KEY_PREFIX = 'little-chapters-session-mechanics:';
const RECENT_HISTORY_MAX = 4;

function historyKey(uid: string | null): string {
  return `${RECENT_HISTORY_KEY_PREFIX}${uid ?? 'anon'}`;
}

export function loadRecentSessionMechanics(uid: string | null): MechanicKind[][] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(historyKey(uid)) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    const valid: MechanicKind[] = ['sound-hunt', 'find-in-scene', 'prediction', 'word-builder'];
    return raw
      .filter((row): row is unknown[] => Array.isArray(row))
      .map((row) => row.filter((item): item is MechanicKind => typeof item === 'string' && (valid as string[]).includes(item)))
      .filter((row) => row.length > 0)
      .slice(0, RECENT_HISTORY_MAX);
  } catch { return []; }
}

export function recordSessionMechanics(uid: string | null, sequence: MechanicKind[]): void {
  if (typeof window === 'undefined') return;
  try {
    const previous = loadRecentSessionMechanics(uid);
    const next = [sequence, ...previous].slice(0, RECENT_HISTORY_MAX);
    localStorage.setItem(historyKey(uid), JSON.stringify(next));
  } catch { /* best-effort — variation memory is a nicety, not correctness */ }
}

function stableHash(input: string): number {
  let h = 5381 >>> 0;
  for (let i = 0; i < input.length; i++) h = ((h * 33) ^ input.charCodeAt(i)) >>> 0;
  return h;
}

function positionalOverlap(a: MechanicKind[], b: MechanicKind[]): number {
  let n = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) if (a[i] === b[i]) n++;
  return n;
}

/** Rank candidates. Lower score is better.
 *  Contributions:
 *    +12 exact match with yesterday's plan (heaviest penalty — never repeat)
 *    +6  exact match with any recent plan
 *    +2  same first mechanic as yesterday (position-repetition)
 *    +2  same last mechanic as yesterday (position-repetition)
 *    +5  sequence uses a mechanic that isn't available in this chapter
 *    +3  sequence includes no literacy mechanic (sound-hunt or word-builder)
 *          — allowed occasionally, but the ranker keeps it rare
 *    tie: deterministic hash of (chapterId + candidate index) */
function scoreCandidate(candidate: MechanicKind[], inputs: CompositionInputs, index: number): { score: number; tie: number } {
  const yesterday = inputs.recent[0] ?? [];
  let score = 0;
  const literacy = candidate.some((mechanic) => mechanic === 'sound-hunt' || mechanic === 'word-builder');
  if (!literacy) score += 3;
  if (candidate.some((mechanic) => !inputs.available[mechanic])) score += 5;
  if (yesterday.length && yesterday.every((mechanic, i) => candidate[i] === mechanic)) score += 12;
  for (const previous of inputs.recent.slice(1)) {
    if (previous.length && previous.every((mechanic, i) => candidate[i] === mechanic)) { score += 6; break; }
  }
  if (yesterday[0] && candidate[0] === yesterday[0]) score += 2;
  if (yesterday.at(-1) && candidate.at(-1) === yesterday.at(-1)) score += 2;
  // Small positional-overlap contribution across all positions so a sequence
  // that only swaps the middle mechanic isn't considered "as fresh" as one
  // that shuffles two.
  score += positionalOverlap(candidate, yesterday);
  return { score, tie: stableHash(`${inputs.chapterId}:${index}`) };
}

export function composeSession(inputs: CompositionInputs): CompositionResult {
  const ranked = CANDIDATE_SEQUENCES
    .map((candidate, index) => ({ candidate, ...scoreCandidate(candidate, inputs, index) }))
    .sort((a, b) => (a.score !== b.score ? a.score - b.score : a.tie - b.tie));
  const winner = ranked[0];
  return {
    sequence: winner.candidate,
    reason: `chapter=${inputs.chapterId} recent=${inputs.recent.length} pick=${winner.candidate.join('→')} score=${winner.score}`,
  };
}

/** Test helper: given `n` different chapter ids and the current recent
 *  history, how many DISTINCT sequences would the composer choose? Higher is
 *  better — meaningful variety without random noise. */
export function distinctSequencesAcross(chapterIds: string[], recent: MechanicKind[][], available: Record<MechanicKind, boolean>): number {
  const seen = new Set<string>();
  for (const chapterId of chapterIds) {
    const { sequence } = composeSession({ chapterId, available, recent });
    seen.add(sequence.join('|'));
  }
  return seen.size;
}
