/**
 * The two validators. Both have a zero acceptable failure rate.
 *
 * These are a BACKSTOP, not the mechanism. The site says openly: "Built in, not
 * filtered: these rules are part of how every chapter is made, not something we
 * check for afterwards." The skeleton and the palette are what make chapters
 * legal. If these validators fire often, the generator prompt is wrong - fix
 * that rather than leaning harder on rejection.
 */

import {
  allowedWordsForStage,
  CONTENT_BLOCKLIST,
  HUMAN_NOUNS,
  getStage,
  tokenize,
} from '../content/stages.js';

export interface Violation {
  rule: string;
  word?: string;
  sentenceIndex?: number;
  detail: string;
}

export interface ValidationResult {
  ok: boolean;
  violations: Violation[];
  /** Offending words, deduplicated, for the retry prompt and the log. */
  offendingWords: string[];
}

export interface StoryDraft {
  sentences: string[];
  imagePrompt: string;
  summaryLine: string;
}

export interface CastContext {
  childName: string;
  petName?: string;
  /** Proper nouns the child knows and that are exempt from decoding checks. */
  extraProperNouns?: string[];
}

const ok = (): ValidationResult => ({ ok: true, violations: [], offendingWords: [] });

function fail(violations: Violation[]): ValidationResult {
  return {
    ok: violations.length === 0,
    violations,
    offendingWords: [...new Set(violations.map((v) => v.word).filter(Boolean) as string[])],
  };
}

// --- a) phonics -------------------------------------------------------------

/**
 * Every word must be in the stage's allowed set, be an approved proper noun, or
 * be one of at most `maxPreviewWords` stretch words from the next stage.
 */
export function validatePhonics(
  draft: StoryDraft,
  stage: number,
  cast: CastContext,
  maxPreviewWords = 2,
): ValidationResult {
  const allowed = allowedWordsForStage(stage);
  const nextAllowed =
    stage < 10 ? allowedWordsForStage(stage + 1) : new Set<string>();

  const proper = new Set(
    [cast.childName, cast.petName, ...(cast.extraProperNouns ?? [])]
      .filter(Boolean)
      .map((n) => (n as string).toLowerCase()),
  );

  const violations: Violation[] = [];
  const previewSeen = new Set<string>();

  draft.sentences.forEach((sentence, i) => {
    for (const token of tokenize(sentence)) {
      if (allowed.has(token) || proper.has(token)) continue;

      if (nextAllowed.has(token)) {
        previewSeen.add(token);
        continue;
      }

      violations.push({
        rule: 'phonics/not-decodable',
        word: token,
        sentenceIndex: i,
        detail: `"${token}" is not in the stage ${stage} allowed set, not a known proper noun, and not available at stage ${stage + 1}`,
      });
    }
  });

  if (previewSeen.size > maxPreviewWords) {
    violations.push({
      rule: 'phonics/too-many-preview-words',
      detail: `${previewSeen.size} next-stage words (${[...previewSeen].join(', ')}), max is ${maxPreviewWords}`,
    });
  }

  // Sentence length is a phonics-adjacent constraint: it comes off the stage.
  const { min, max } = getStage(stage).sentence_length;
  draft.sentences.forEach((sentence, i) => {
    const n = tokenize(sentence).length;
    if (n < min || n > max) {
      violations.push({
        rule: 'phonics/sentence-length',
        sentenceIndex: i,
        detail: `sentence ${i} has ${n} words, stage ${stage} allows ${min}-${max}`,
      });
    }
  });

  return violations.length ? fail(violations) : ok();
}

// --- b) content -------------------------------------------------------------

/**
 * The cast is the child, their pet, and one animal or object. No other humans
 * at all. Nothing frightening.
 *
 * The site puts it well: "Because there are simply no other people in these
 * stories, whole categories of things you might not want your child reading
 * can't happen in the first place."
 */
export function validateContent(draft: StoryDraft, cast: CastContext): ValidationResult {
  const violations: Violation[] = [];
  const allowedNames = new Set(
    [cast.childName, cast.petName, ...(cast.extraProperNouns ?? [])]
      .filter(Boolean)
      .map((n) => (n as string).toLowerCase()),
  );

  const body = [...draft.sentences, draft.summaryLine, draft.imagePrompt];

  body.forEach((text, i) => {
    for (const token of tokenize(text)) {
      if (HUMAN_NOUNS.has(token) && !allowedNames.has(token)) {
        violations.push({
          rule: 'content/human-character',
          word: token,
          sentenceIndex: i,
          detail: `"${token}" introduces a human other than the child`,
        });
      }
      if (CONTENT_BLOCKLIST.has(token)) {
        violations.push({
          rule: 'content/blocklisted',
          word: token,
          sentenceIndex: i,
          detail: `"${token}" is on the content blocklist`,
        });
      }
    }
  });

  // Capitalised words mid-sentence are almost always a smuggled-in character
  // or place name. Cheap check, catches a lot.
  draft.sentences.forEach((sentence, i) => {
    const words = sentence.split(/\s+/);
    words.slice(1).forEach((raw) => {
      const w = raw.replace(/[^A-Za-z]/g, '');
      if (w.length > 1 && w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase()) {
        if (!allowedNames.has(w.toLowerCase()) && w !== 'I') {
          violations.push({
            rule: 'content/unknown-proper-noun',
            word: w,
            sentenceIndex: i,
            detail: `"${w}" is capitalised mid-sentence and is not the child or their pet`,
          });
        }
      }
    });
  });

  return violations.length ? fail(violations) : ok();
}

export function validateAll(
  draft: StoryDraft,
  stage: number,
  cast: CastContext,
): ValidationResult {
  const p = validatePhonics(draft, stage, cast);
  const c = validateContent(draft, cast);
  const violations = [...p.violations, ...c.violations];
  return violations.length ? fail(violations) : ok();
}
