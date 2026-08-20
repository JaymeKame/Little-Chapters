/* Copy + phoneme-cue lookup for the three-rung help ladder, sourced from
 * reading-tutor/content/config.json (help_template) and stages.json (per-
 * stage new_graphemes). This file makes no pedagogical decisions of its
 * own — it only renders the config's own line templates and finds the
 * config's own phoneme for a grapheme in the tricky word. Rung SEQUENCING
 * (when to escalate, when to mark assisted) lives in app/read/page.tsx,
 * next to the rest of the reading state machine — not here.
 *
 * Consumed by both the Next.js app (extensionless imports, as everywhere
 * else in reading-tutor/content) and by dev scripts run through tsx (same
 * as reading-tutor/test/run.ts) — plain `node` cannot resolve the bare
 * config.json import without `tsx`/webpack's loader, so any standalone
 * script importing this file needs the same tsx runner reading-tutor's own
 * tests use, not plain node. */

import configDoc from '../reading-tutor/content/config.json';
import { STAGES, clampStage, type Grapheme } from '../reading-tutor/content/stages';

export interface HelpLadderConfig {
  confidence_floor: number;
  silence_timeout_ms: number;
  max_retries: number;
  help_template: {
    rungs: { level: 1 | 2 | 3; trigger: string; gives: string; line: string; note: string }[];
  };
  encouragement_lines: string[];
  rules: {
    never_say: string[];
    no_exclamation_marks: boolean;
  };
}

export const HELP_LADDER: HelpLadderConfig = configDoc as HelpLadderConfig;

export const ENCOURAGEMENT_LINES: readonly string[] = HELP_LADDER.encouragement_lines;

const graphemeCache = new Map<number, Grapheme[]>();

/** Every grapheme introduced at or before `stage`, longest first so a
 *  multi-letter grapheme ("sh") is preferred over a single letter it
 *  contains ("s"). */
function cumulativeGraphemes(stage: number): Grapheme[] {
  const s = clampStage(stage);
  const hit = graphemeCache.get(s);
  if (hit) return hit;
  const graphemes: Grapheme[] = [];
  for (const st of STAGES) {
    if (st.id > s) break;
    graphemes.push(...st.phonics.new_graphemes);
  }
  graphemes.sort((a, b) => b.grapheme.length - a.grapheme.length);
  graphemeCache.set(s, graphemes);
  return graphemes;
}

/** The phoneme cue for the grapheme the child stalled on, per rung 1's own
 *  note in config.json: "{phoneme} comes from the stage file's
 *  new_graphemes for the grapheme the child stalled on." Prefers a
 *  grapheme the word BEGINS with (the line says "begins with"), falling
 *  back to one found anywhere in the word, then to a generic first-letter
 *  cue if the word uses no grapheme introduced yet at this stage. */
export function graphemeCueFor(word: string, stage: number): string {
  const lower = word.toLowerCase();
  const graphemes = cumulativeGraphemes(stage);
  const starting = graphemes.find((g) => lower.startsWith(g.grapheme.toLowerCase()));
  if (starting) return starting.phoneme;
  const anywhere = graphemes.find((g) => lower.includes(g.grapheme.toLowerCase()));
  if (anywhere) return anywhere.phoneme;
  return `/${lower.charAt(0)}/`;
}

/** Renders one rung's line from config.json verbatim, filling whichever of
 *  {phoneme}/{word}/{sentence} that rung's template uses. The template text
 *  itself is never altered here — only its blanks are filled — so a copy
 *  change in config.json is the only place that ever needs editing. */
export function rungLine(rung: 1 | 2 | 3, opts: { word: string; sentence: string; stage: number }): string {
  const template = HELP_LADDER.help_template.rungs[rung - 1].line;
  return template
    .replace('{phoneme}', () => graphemeCueFor(opts.word, opts.stage))
    .replace('{word}', () => opts.word)
    .replace('{sentence}', () => opts.sentence);
}

export function pickEncouragement(): string {
  return ENCOURAGEMENT_LINES[Math.floor(Math.random() * ENCOURAGEMENT_LINES.length)];
}
