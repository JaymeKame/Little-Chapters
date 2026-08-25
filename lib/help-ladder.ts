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
import { STAGES, STAGES_DOC, clampStage, type Grapheme, type SightWordProvenance } from '../reading-tutor/content/stages';

export interface HelpLadderConfig {
  confidence_floor: number;
  silence_timeout_ms: number;
  max_retries: number;
  help_template: {
    rungs: { level: 1 | 2 | 3; trigger: string; gives: string; line: string; note: string }[];
    phrase_retry_line: string;
    phrase_retry_note: string;
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

/* ── Word segmentation for the slide-through help interaction ──────────── */

export interface WordSegment {
  /** The literal letters this segment covers, exactly as they appear in the
   *  word (child-facing — never a phoneme label; see segmentWord's doc). */
  text: string;
  /** Curriculum phoneme cue for spoken modeling; never a letter name. */
  phoneme?: string;
}

/** Some grapheme ids in stages.json carry a pronunciation-disambiguation
 *  suffix after an underscore — "ow_o" (snow) vs "ow_ow" (cow) are the SAME
 *  two letters on the page with two different sounds. Segmentation only
 *  needs the letters the child sees, never which sound they make here, so
 *  these collapse to their shared literal substring.
 *
 *  The true split silent-e family (a_e/i_e/o_e/u_e/e_e, stage 6+: "gate",
 *  "bike", "bone"...) is NOT a suffix on a real substring — the pattern is
 *  discontinuous (vowel ... consonant ... terminal e), and there is no
 *  single contiguous string to collapse it to. Approximating it (e.g.
 *  guessing which single consonant sits between the vowel and the silent e)
 *  is exactly the kind of guess segmentWord's confidence rule refuses to
 *  make, so these return null and the word falls through to full failure
 *  below — intentional, not a gap to "fix" by pattern-matching later
 *  without a real design for how a discontinuous span renders as tiles. */
const DISCONTINUOUS_GRAPHEMES = new Set(['a_e', 'i_e', 'o_e', 'u_e', 'e_e']);

function surfaceForm(grapheme: string): string | null {
  if (DISCONTINUOUS_GRAPHEMES.has(grapheme)) return null;
  const cut = grapheme.indexOf('_');
  return cut === -1 ? grapheme : grapheme.slice(0, cut);
}

/** Greedy longest-match segmentation of `word` against every grapheme the
 *  child has actually been taught at or before `stage`. Returns the ordered
 *  chunks the slide interaction highlights left to right, or `null` when the
 *  word cannot be FULLY covered this way.
 *
 *  This is deliberately conservative, per product rule: if the greedy match
 *  ever gets stuck — no known grapheme starts at the current position — the
 *  function returns null rather than guessing, approximating, or falling
 *  back to an unknown single letter. The caller's job is to skip the slide
 *  interaction entirely for that word and use the existing rung 1/2/3 help
 *  ladder, exactly as it worked before this feature existed. */
export function segmentWord(word: string, stage: number): WordSegment[] | null {
  const lower = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!lower) return null;

  // Re-sorted by TRUE surface length (not the raw, possibly underscore-
  // inflated, id length cumulativeGraphemes sorts by) so a real two-letter
  // match is never skipped in favor of a shorter one, and vice versa.
  const candidates = cumulativeGraphemes(stage)
    .map((g) => ({ surface: surfaceForm(g.grapheme), phoneme: g.phoneme }))
    .filter((item): item is { surface: string; phoneme: string } => !!item.surface)
    .sort((a, b) => b.surface.length - a.surface.length);

  const segments: WordSegment[] = [];
  let i = 0;
  while (i < lower.length) {
    const match = candidates.find((item) => lower.startsWith(item.surface, i));
    if (!match) return null; // stuck — do not guess
    segments.push({ text: lower.slice(i, i + match.surface.length), phoneme: match.phoneme });
    i += match.surface.length;
  }

  // A word can still greedily "succeed" letter-by-letter while actually
  // needing the split silent-e pattern above — e.g. "gate" parses cleanly as
  // g/a/t/e via four independently-known single letters, but that shape
  // teaches the wrong thing (it drops the very rule that makes the "a" say
  // its name). Recognize that specific shape from the finished segments —
  // a lone vowel, then a lone consonant, then a trailing lone "e" — and
  // refuse it rather than ship a technically-clean but pedagogically wrong
  // slide. This is a shape check on the RESULT, not a second parsing pass.
  const n = segments.length;
  if (n >= 3) {
    const [vowelSeg, consonantSeg, eSeg] = segments.slice(n - 3);
    const isSingleVowel = vowelSeg.text.length === 1 && 'aeiou'.includes(vowelSeg.text);
    const isSingleConsonant = consonantSeg.text.length === 1 && !'aeiou'.includes(consonantSeg.text);
    if (isSingleVowel && isSingleConsonant && eSeg.text === 'e') return null;
  }

  return segments;
}

/* sight_word_provenance keyed lowercase — the JSON's own keys keep their
 * typeset casing ("I"), but every caller here compares against a lowercased
 * word. Built once; the source table is small and static. */
const provenanceByLowerWord = new Map<string, SightWordProvenance>(
  Object.entries(STAGES_DOC.sight_word_provenance).map(([w, p]) => [w.toLowerCase(), p]),
);

/** Whether `word` is safe to TEACH via the slide-through grapheme-blending
 *  interaction at `stage` — segmentability alone is not enough. segmentWord()
 *  only knows whether known graphemes happen to cover the letters; it has no
 *  notion of true linguistic irregularity, so a permanently-irregular sight
 *  word ("the", "was", "said"...) can still parse cleanly letter-by-letter
 *  and "succeed" even though blending it produces the wrong sound (sliding
 *  "the" as t-h-e teaches a sound nothing like the real, irregular "thuh").
 *
 *  Rather than inventing a new irregularity ruleset, this cross-references
 *  the curriculum's own sight_word_provenance (already the source of truth
 *  for the allowed-word set elsewhere — reading-tutor/content/stages.ts). A
 *  word is blocked from the slider when the curriculum itself says it is
 *  still irregular at this stage: `becomes_decodable_at_stage` is null (it
 *  never becomes safe to blend), or the child hasn't reached that stage yet.
 *  A word with no provenance entry at all is a purely decodable word — only
 *  segmentWord()'s own answer governs it, unchanged.
 *
 *  This is the actual slider-eligibility gate; segmentWord() itself is
 *  intentionally untouched — everywhere in app/read/page.tsx that used to
 *  ask "can this be segmented?" should ask this instead. */
export function canTeachWithSlider(word: string, stage: number): WordSegment[] | null {
  const segments = segmentWord(word, stage);
  if (!segments) return null;
  const provenance = provenanceByLowerWord.get(word.toLowerCase());
  if (provenance && (provenance.becomes_decodable_at_stage === null || stage < provenance.becomes_decodable_at_stage)) {
    return null;
  }
  return segments;
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

/** The phrase-level retry line (see config.json's phrase_retry_note) — only
 *  fills {sentence}, same as rung 3's line. */
export function phraseRetryLine(sentence: string): string {
  return HELP_LADDER.help_template.phrase_retry_line.replace('{sentence}', () => sentence);
}

export function pickEncouragement(): string {
  return ENCOURAGEMENT_LINES[Math.floor(Math.random() * ENCOURAGEMENT_LINES.length)];
}
