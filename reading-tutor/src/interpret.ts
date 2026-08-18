/**
 * Turns raw word signal into verdicts and an accuracy number.
 *
 * Every threshold here is deliberately generous. The product's failure mode is
 * not "we missed a mistake" - that costs nothing. It is "we told a five-year-old
 * they got a word wrong when they didn't", which makes them feel stupid and
 * makes the parent cancel. When in doubt, the word is correct.
 */

import type {
  SessionInput,
  SessionReading,
  WordOutcome,
  WordSignal,
} from './types.js';

export interface InterpretConfig {
  /** Below this, we are not confident the child said the word. Biased low. */
  confidenceFloor: number;
  /** A pause longer than this before a word means they had to work it out. */
  longGapMs: number;
  /** Taking longer than this to say one word means they sounded it out. */
  longDurationMs: number;
  /**
   * If more than this share of sentences were read to the child, the session
   * reflects their night rather than their reading, and must not move the stage.
   */
  assistedHeavyThreshold: number;
  /** Below this many counted words, the sample is too small to act on. */
  minCountableWords: number;
}

export const DEFAULT_INTERPRET_CONFIG: InterpretConfig = {
  confidenceFloor: 0.35,
  longGapMs: 1200,
  longDurationMs: 1800,
  assistedHeavyThreshold: 0.4,
  minCountableWords: 12,
};

function judge(w: WordSignal, cfg: InterpretConfig): WordOutcome {
  if (!w.heard) {
    return { word: w.word, verdict: 'missed', reason: 'nothing heard in slot' };
  }
  if (w.confidence < cfg.confidenceFloor) {
    return {
      word: w.word,
      verdict: 'stumbled',
      reason: `confidence ${w.confidence.toFixed(2)} below floor ${cfg.confidenceFloor}`,
    };
  }
  // Read it, but had to work for it. Counts as read, flagged for reinforcement.
  if (w.gap_before_ms > cfg.longGapMs) {
    return {
      word: w.word,
      verdict: 'stumbled',
      reason: `paused ${w.gap_before_ms}ms before starting`,
    };
  }
  if (w.duration_ms > cfg.longDurationMs) {
    return {
      word: w.word,
      verdict: 'stumbled',
      reason: `took ${w.duration_ms}ms to say, likely sounded out`,
    };
  }
  return { word: w.word, verdict: 'correct', reason: 'clean' };
}

export function interpretSession(
  session: SessionInput,
  cfg: InterpretConfig = DEFAULT_INTERPRET_CONFIG,
  previouslyTricky: string[] = [],
): SessionReading {
  const outcomes: WordOutcome[] = [];

  for (const s of session.sentences) {
    // Sentences read TO the child, and the optional reread afterwards, tell us
    // nothing about what the child can decode. They are excluded from BOTH the
    // numerator and the denominator - not counted as failures, not counted at
    // all. Counting them either way would be wrong.
    const excludedBecause = s.assisted ? 'assisted' : s.reread ? 'reread' : undefined;

    for (const w of s.words) {
      if (excludedBecause) {
        outcomes.push({
          word: w.word,
          verdict: 'excluded',
          excludedBecause,
          reason: `sentence ${s.index} was ${excludedBecause}`,
        });
      } else {
        outcomes.push(judge(w, cfg));
      }
    }
  }

  const counted = outcomes.filter((o) => o.verdict !== 'excluded');
  const correct = counted.filter((o) => o.verdict === 'correct').length;
  const accuracy = counted.length > 0 ? correct / counted.length : null;

  const totalSentences = session.sentences.length;
  const assistedShare =
    totalSentences > 0
      ? session.sentences.filter((s) => s.assisted).length / totalSentences
      : 0;

  let excludedFromProgression = false;
  let excludedReason: SessionReading['excludedReason'];

  if (session.isBookshelfReread) {
    // A child rereading a chapter they love may have half of it memorised.
    // Wonderful for fluency, useless as evidence of decoding.
    excludedFromProgression = true;
    excludedReason = 'bookshelf-reread';
  } else if (assistedShare > cfg.assistedHeavyThreshold) {
    excludedFromProgression = true;
    excludedReason = 'assisted-heavy';
  } else if (counted.length < cfg.minCountableWords) {
    excludedFromProgression = true;
    excludedReason = 'too-few-words';
  }

  const trickyWords = [
    ...new Set(
      counted
        .filter((o) => o.verdict === 'stumbled' || o.verdict === 'missed')
        .map((o) => o.word),
    ),
  ];

  // A word counts as a win if they read it cleanly tonight and it was on the
  // tricky list coming in. This is what the parent SMS names.
  const trickyBefore = new Set(previouslyTricky);
  const cleanWords = [
    ...new Set(
      counted
        .filter((o) => o.verdict === 'correct' && trickyBefore.has(o.word))
        .map((o) => o.word),
    ),
  ];

  return {
    sessionId: session.sessionId,
    stage: session.stage,
    words: outcomes,
    accuracy,
    countedWords: counted.length,
    excludedWords: outcomes.length - counted.length,
    assistedShare,
    excludedFromProgression,
    excludedReason,
    trickyWords,
    cleanWords,
  };
}

/**
 * Strips everything that must never leave the batch job.
 *
 * Call this before writing to Firestore. It exists so that persisting a score
 * requires deliberately bypassing it rather than merely forgetting.
 */
export function toPersistable(r: SessionReading) {
  return {
    sessionId: r.sessionId,
    stage: r.stage,
    trickyWords: r.trickyWords,
    cleanWords: r.cleanWords,
    countedWords: r.countedWords,
    wasAssistedHeavy: r.excludedReason === 'assisted-heavy',
    // accuracy is deliberately absent
  };
}
