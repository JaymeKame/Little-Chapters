/* Hybrid per-word decoding verdicts: "does this word need help?"
 *
 * Two graders vote, each covering the other's blind spot (calibrated on
 * speechocean762 child clips vs expert phoneticians — docs/DECODING_GRADER.md):
 *  - the MDD phoneme service (lexicon-free, catches wrong-word decoding that
 *    Azure's language model "corrects" back to the expected word), and
 *  - Azure's per-word minimum phoneme score (precise, but word scores alone
 *    pass clear decoding failures).
 * A word is flagged only when BOTH object — either grader alone is far too
 * trigger-happy for a 5-year-old (raw MDD flagged 38% of expert-perfect
 * words in calibration).                                                     */

import type { WordScore } from '@/lib/pronunciation';

/* Thresholds from the 100-clip / 431-word calibration grid search
 * (2026-08-11): hybrid mdd<70 & minph<50 → precision 0.34, recall 0.49,
 * 15/20 clearly-bad words caught, 13.5% false-flag rate on expert-perfect
 * words. Note the corpus skews strict: "perfect" was judged under L2-lenient
 * criteria on accented speech, so real-world precision should be better.
 * Azure-only fallback minph<40 → precision 0.40, 8.5% false-flag rate.      */
export const VERDICT_THRESHOLDS = {
  /** Flag when MDD word score (0–100) is below this … */
  mddBelow: 70,
  /** … AND Azure's minimum phoneme accuracy (0–100) is below this. */
  azureMinPhonemeBelow: 50,
  /** Azure-only fallback (MDD service down): flag below this min-phoneme. */
  azureOnlyMinPhonemeBelow: 40,
};

export interface DecodeWord {
  word: string;
  /** Phoneme error rate vs the expected pronunciation (0 = perfect). */
  per: number;
  /** max(0, 1-per)*100. */
  score: number;
  expected: string;
  heard: string;
}

export interface DecodeResult {
  recognized: string;
  words: DecodeWord[];
  sentence_score: number;
}

export interface WordVerdict {
  word: string;
  errorType: WordScore['errorType'];
  azureAccuracy: number | null;
  azureMinPhoneme: number | null;
  /** null when the MDD service was unavailable. */
  decodeScore: number | null;
  decodeHeard: string | null;
  needsHelp: boolean;
  /** Which rule fired — for tuning/debugging, not kid-facing copy. */
  reason: 'omitted' | 'both-graders' | 'azure-only-fallback' | null;
}

function minPhoneme(w: WordScore): number | null {
  const scores = w.phonemes.map((p) => p.accuracy).filter((a): a is number => a != null);
  return scores.length ? Math.min(...scores) : null;
}

/* azureWords: the reference-aligned words from ReadingAssessmentResult
 * (insertions included, omissions synthesized). decode: the MDD response for
 * the same reference text, one entry per reference word, or null when the
 * service is down. Non-insertion Azure words map 1:1, in order, onto decode
 * words — both follow reference-text order.                                  */
export function combineVerdicts(azureWords: WordScore[], decode: DecodeResult | null): WordVerdict[] {
  const t = VERDICT_THRESHOLDS;
  let refIndex = 0;
  return azureWords.map((w) => {
    const isInsertion = w.errorType === 'Insertion';
    const d = !isInsertion && decode ? (decode.words[refIndex] ?? null) : null;
    if (!isInsertion) refIndex += 1;

    const azMinPh = minPhoneme(w);
    let needsHelp = false;
    let reason: WordVerdict['reason'] = null;
    if (w.errorType === 'Omission') {
      needsHelp = true;
      reason = 'omitted';
    } else if (!isInsertion && w.errorType !== 'Unassessed') {
      if (d) {
        if (d.score < t.mddBelow && azMinPh != null && azMinPh < t.azureMinPhonemeBelow) {
          needsHelp = true;
          reason = 'both-graders';
        }
      } else if (azMinPh != null && azMinPh < t.azureOnlyMinPhonemeBelow) {
        needsHelp = true;
        reason = 'azure-only-fallback';
      }
    }
    return {
      word: w.word,
      errorType: w.errorType,
      azureAccuracy: w.accuracy,
      azureMinPhoneme: azMinPh,
      decodeScore: d ? d.score : null,
      decodeHeard: d ? d.heard : null,
      needsHelp,
      reason,
    };
  });
}
