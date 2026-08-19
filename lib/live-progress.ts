/* Live word-by-word reading progress, fed by streaming partial transcripts.
 *
 * Azure's continuous recognizer emits growing partial text for the CURRENT
 * utterance (each new utterance restarts from empty), then a finalized
 * segment. We track two cursors over the reference tokens:
 *
 *   base — locked in by finalized segments; where the next utterance starts
 *   peak — the furthest position ever matched (monotonic: partials get
 *          revised by the recognizer, and a highlight that retreats reads as
 *          "you un-read that word" to a 5-year-old)
 *
 * Matching rules, in order, per heard word:
 *   repeat  — a word equal to the one just matched is a stutter/re-read;
 *             ignore it (else "the the" would match a LATER "the" and throw
 *             the highlight ahead of the child)
 *   window  — greedy scan of the next 3 reference tokens, so a single
 *             misread or misheard word is jumped as soon as a later word
 *             matches
 *   anchor  — after 2 consecutive misses the cursor is lost (child skipped a
 *             line, or a run of misrecognitions); re-sync with an unbounded
 *             forward search for a BIGRAM (this heard word + the next one
 *             matching two consecutive reference tokens). Requiring the pair
 *             keeps a stray function word from teleporting the cursor.
 *
 * The highlight tracks the child's PLACE in the text, not their accuracy —
 * correctness feedback stays where it belongs, in the post-read verdicts.
 *
 * Hyphenated reference words ("twenty-one") are matched as their parts,
 * because Azure's word stream splits them — but they count as ONE display
 * word, so the karaoke index in PageText (which renders whitespace tokens)
 * never drifts. Curly apostrophes are folded to ASCII: the reference text is
 * typeset, Azure output is not.                                             */

const foldApostrophes = (t: string) => t.replace(/[’ʼ]/g, "'");

const normalize = (t: string) => foldApostrophes(t).toLowerCase().replace(/[^a-z0-9']/g, '');

/** Heard side: split on whitespace AND hyphens (display-format partials can
 *  contain "twenty-one"; the lexical word stream never does). */
export function tokenizeWords(text: string): string[] {
  return text.split(/[\s‐-―-]+/).map(normalize).filter(Boolean);
}

interface FlatToken {
  tok: string;
  /** Index of the display (whitespace-delimited) word this part belongs to. */
  wordIdx: number;
}

/** Reference side: whitespace tokens define display indices (identical word
 *  counting to PageText); hyphen-split parts are what we match against. */
function flattenReference(referenceText: string): { flat: FlatToken[]; totalWords: number } {
  const flat: FlatToken[] = [];
  let wordIdx = 0;
  for (const raw of referenceText.split(/\s+/)) {
    const parts = raw.split(/[‐-―-]/).map(normalize).filter(Boolean);
    if (parts.length === 0) continue; // pure punctuation — PageText skips it too
    for (const tok of parts) flat.push({ tok, wordIdx });
    wordIdx++;
  }
  return { flat, totalWords: wordIdx };
}

function advanceThrough(flat: FlatToken[], from: number, heard: string[]): number {
  let j = from;
  let misses = 0;
  for (let i = 0; i < heard.length; i++) {
    const h = heard[i];
    // Stutter / re-read of the word just matched: neutral, not a miss.
    if (j > 0 && flat[j - 1].tok === h) continue;
    let matched = false;
    for (let k = j; k < Math.min(j + 3, flat.length); k++) {
      if (flat[k].tok === h) {
        j = k + 1;
        misses = 0;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    misses++;
    // Lost the place — re-anchor on the next bigram match ahead.
    if (misses >= 2 && i + 1 < heard.length) {
      const next = heard[i + 1];
      for (let p = j; p + 1 < flat.length; p++) {
        if (flat[p].tok === h && flat[p + 1].tok === next) {
          j = p + 1;
          misses = 0;
          break;
        }
      }
    }
  }
  return j;
}

export interface LiveProgress {
  /** Number of display words in the reference. */
  total: number;
  /** Feed a partial transcript; returns display words read so far (monotonic). */
  partial(text: string): number;
  /** Feed a finalized segment's recognized words; returns display words read so far. */
  segment(words: string[]): number;
  /** True once EVERY reference token has been heard — including all parts of
   *  a hyphenated final word, so a fast-stop never cuts the mic mid-word. */
  isComplete(): boolean;
}

export function createLiveProgress(referenceText: string): LiveProgress {
  const { flat, totalWords } = flattenReference(referenceText);
  let base = 0; // flat-token cursor locked by finalized segments
  let peak = 0; // furthest flat-token cursor ever reached
  const displayCount = () => (peak === 0 ? 0 : flat[peak - 1].wordIdx + 1);
  return {
    total: totalWords,
    partial(text) {
      peak = Math.max(peak, advanceThrough(flat, base, tokenizeWords(text)));
      return displayCount();
    },
    segment(words) {
      base = advanceThrough(flat, base, words.flatMap((w) => tokenizeWords(w)));
      peak = Math.max(peak, base);
      return displayCount();
    },
    isComplete() {
      return peak >= flat.length;
    },
  };
}
