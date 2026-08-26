import type { WordScore } from './pronunciation.ts';

export const TRACKER_CONFIDENCE_MIN = 72;

/** Guidance only: finalized, sufficiently confident recognized words may
 * advance the visual place marker. Ambiguous/misread results are held for the
 * existing verdict pipeline and can never create a correction themselves. */
export function confidentTrackerWords(words: WordScore[]): string[] {
  return words
    .filter((word) => word.accuracy != null && word.accuracy >= TRACKER_CONFIDENCE_MIN && word.errorType !== 'Omission')
    .map((word) => word.word);
}
