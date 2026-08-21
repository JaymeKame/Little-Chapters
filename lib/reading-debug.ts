import type { WordVerdict } from './reading-verdict';

export type ReadingGradingMode = 'azure+mdd' | 'azure-only';

export interface ReadingDebugWord {
  word: string;
  needsHelp: boolean;
  reason: WordVerdict['reason'];
  azureAccuracy: number | null;
  azureMinPhoneme: number | null;
  decodeScore: number | null;
  graders: ReadingGradingMode;
}

export interface ReadingDebugPayload {
  gradingMode: ReadingGradingMode;
  words: ReadingDebugWord[];
}

export function readingDebugEnabled(search: string): boolean {
  return new URLSearchParams(search).get('debugReading') === '1';
}

/** A deliberately narrow, non-persistent view of the already-final verdict. */
export function buildReadingDebugPayload(
  verdicts: WordVerdict[],
  mddAvailable: boolean,
): ReadingDebugPayload {
  const gradingMode: ReadingGradingMode = mddAvailable ? 'azure+mdd' : 'azure-only';
  return {
    gradingMode,
    words: verdicts.map((verdict) => ({
      word: verdict.word,
      needsHelp: verdict.needsHelp,
      reason: verdict.reason,
      azureAccuracy: verdict.azureAccuracy,
      azureMinPhoneme: verdict.azureMinPhoneme,
      decodeScore: verdict.decodeScore,
      graders: gradingMode,
    })),
  };
}
