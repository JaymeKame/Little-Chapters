/**
 * Fills the blanks in a story skeleton.
 *
 * This is the difference between "built in" and "filtered". The model never
 * chooses a noun. The code picks every one from the stage palette before
 * generation starts, so an off-level or unsafe noun is impossible rather than
 * caught afterwards. The validators become a genuine backstop instead of the
 * main line of defence, which is what the site promises publicly.
 */

import vocab from '../content/slot-vocab.json';

/**
 * `portable` and `fixture` partition `object`.
 *
 * Use `portable` whenever the story moves the thing, hides it, or carries it
 * somewhere. Use `object` only when it genuinely does not matter, since that
 * gives the widest choice and the least repetition.
 */
export type SlotType = 'creature' | 'portable' | 'fixture' | 'object' | 'place';
export const SLOT_TYPES: SlotType[] = [
  'creature', 'portable', 'fixture', 'object', 'place',
];

type VocabMap = Record<SlotType, Record<string, number>>;
const SLOT_VOCAB = (vocab as { slots: VocabMap }).slots;

export type SlotAssignment = Partial<Record<SlotType, string>>;

export interface Cast {
  childName: string;
  petName?: string;
}

/** Words of this type a child at this stage is allowed to meet. */
export function slotOptions(type: SlotType, stage: number): string[] {
  return Object.entries(SLOT_VOCAB[type])
    .filter(([, earliest]) => earliest <= stage)
    .map(([word]) => word)
    .sort();
}

/** Which slots a template set actually uses, derived so it cannot drift. */
export function slotsUsed(beats: string[]): SlotType[] {
  const found = new Set<SlotType>();
  for (const b of beats) {
    for (const t of SLOT_TYPES) {
      if (b.includes(`{${t}}`)) found.add(t);
    }
  }
  return SLOT_TYPES.filter((t) => found.has(t));
}

/**
 * Can this skeleton run at this stage?
 *
 * Not just a stage number: a skeleton needing a creature cannot run at stage 1,
 * because stage 1 has no animal nouns at all. Checking the vocabulary directly
 * means adding words to the palette automatically unlocks skeletons.
 */
export function canRunAtStage(beats: string[], stage: number): boolean {
  return slotsUsed(beats).every((t) => slotOptions(t, stage).length > 0);
}

export interface AssignOptions {
  /** Nouns used in recent chapters, avoided when there is enough choice. */
  avoid?: string[];
  /** Injectable for deterministic tests. */
  random?: () => number;
}

export function assignSlots(
  beats: string[],
  stage: number,
  opts: AssignOptions = {},
): SlotAssignment {
  const rand = opts.random ?? Math.random;
  const avoid = new Set(opts.avoid ?? []);
  const assignment: SlotAssignment = {};

  for (const type of slotsUsed(beats)) {
    const all = slotOptions(type, stage);
    if (all.length === 0) {
      throw new Error(
        `No ${type} nouns available at stage ${stage}. ` +
        `Check canRunAtStage before assigning.`,
      );
    }
    // Prefer something the child has not just had, but never at the cost of
    // failing - at stage 1 there may only be one option.
    const unused = all.filter((w) => !avoid.has(w));
    const pool = unused.length ? unused : all;
    assignment[type] = pool[Math.floor(rand() * pool.length)];
  }

  return assignment;
}

/** Substitutes the chosen nouns and the cast into the beat templates. */
export function renderBeats(
  beats: string[],
  assignment: SlotAssignment,
  cast: Cast,
): string[] {
  return beats.map((b) => {
    let out = b
      .replaceAll('{child}', cast.childName)
      .replaceAll('{pet}', cast.petName ?? cast.childName);
    for (const t of SLOT_TYPES) {
      const chosen = assignment[t];
      if (chosen) out = out.replaceAll(`{${t}}`, chosen);
    }
    return out;
  });
}

/** Any {token} left unresolved after rendering. Should always be empty. */
export function unresolvedSlots(rendered: string[]): string[] {
  const left = new Set<string>();
  for (const line of rendered) {
    for (const m of line.matchAll(/\{(\w+)\}/g)) left.add(m[1]);
  }
  return [...left];
}
