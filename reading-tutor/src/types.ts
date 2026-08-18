/**
 * Shared types for the reading tutor rules engine.
 *
 * The boundary with the audio engine is WordSignal. The audio engine measures
 * and reports; it makes no judgements. Every threshold and every definition of
 * "correct" lives on this side of that line.
 */

// --- what the audio engine hands us ----------------------------------------

/**
 * Raw measurement for a single expected word.
 *
 * IMPORTANT: `confidence` must be a 0-1 linear score from forced alignment
 * against the expected word, NOT a raw log-probability and NOT open-vocabulary
 * transcription confidence. If the audio engine cannot produce that, the
 * thresholds in config.json are meaningless and this contract needs revisiting
 * before either side ships.
 */
export interface WordSignal {
  /** The word we expected, exactly as it appeared in the chapter. */
  word: string;
  /** 0-1. How well the audio matched the expected word. */
  confidence: number;
  /** How long the child took to say it. */
  duration_ms: number;
  /** Silence between the previous word and this one. */
  gap_before_ms: number;
  /** Whether anything was detected in this slot at all. */
  heard: boolean;
}

export interface SentenceResult {
  index: number;
  text: string;
  words: WordSignal[];
  /**
   * True when this sentence was read TO the child - the help ladder bottomed
   * out at rung 3, or the child asked to be read to. These words tell us
   * nothing about the child's reading and are excluded from accuracy entirely.
   */
  assisted: boolean;
  /**
   * True when this is the optional reread after rung 3. The child was just
   * fed these words, so a high score here means they can copy, not that they
   * can read. Excluded from accuracy; kept because rereading builds fluency.
   */
  reread: boolean;
}

export interface SessionInput {
  childId: string;
  sessionId: string;
  /** The stage the chapter was written at. */
  stage: number;
  chapterId: string;
  /**
   * True when the child pulled an old chapter off their bookshelf. They may
   * have it half memorised, so the whole session is excluded from progression.
   */
  isBookshelfReread: boolean;
  startedAt: string;
  sentences: SentenceResult[];
}

// --- what we decide about it -----------------------------------------------

export type WordVerdict = 'correct' | 'stumbled' | 'missed' | 'excluded';

export interface WordOutcome {
  word: string;
  verdict: WordVerdict;
  /** Why it was excluded, if it was. Empty for counted words. */
  excludedBecause?: 'assisted' | 'reread';
  /** Which rule fired. Kept for tuning the thresholds, not for display. */
  reason: string;
}

export interface SessionReading {
  sessionId: string;
  stage: number;
  words: WordOutcome[];

  /**
   * NEVER PERSIST THIS. NEVER SEND IT ANYWHERE A PARENT OR CHILD CAN SEE IT.
   *
   * The product promises nothing is ever scored. This number exists only long
   * enough for the progression engine to compare it against a threshold inside
   * the nightly batch, and is then thrown away. If it is never written down,
   * nobody can put it on a screen later.
   *
   * null when the session had no countable words at all.
   */
  accuracy: number | null;

  countedWords: number;
  excludedWords: number;
  /** Proportion of sentences that were read to the child. 0-1. */
  assistedShare: number;
  /** True when this session must not move the child's stage in either direction. */
  excludedFromProgression: boolean;
  excludedReason?: 'bookshelf-reread' | 'assisted-heavy' | 'too-few-words';

  /** Words the child stumbled on or missed. Safe to persist - this is content,
   *  not a score, and the generator and the parent SMS both need it. */
  trickyWords: string[];
  /** Words read cleanly that the child had stumbled on before. The parent SMS
   *  needs these to name a specific win. */
  cleanWords: string[];
}

// --- progression -----------------------------------------------------------

export type StageMove = 'advance' | 'hold' | 'drop';
export type ProgressionMode = 'placement' | 'steady';

/** The only progression state we persist. Note the absence of any score. */
export interface ChildProgress {
  childId: string;
  stage: number;
  /** How many sessions the child has completed, ever. Drives placement exit. */
  sessionsCompleted: number;
  mode: ProgressionMode;
  /** Accuracy of the last few countable sessions, in memory during the batch
   *  only. Persisted as a bounded ring so the rolling window survives restarts;
   *  see the note in progression.ts about why this is the one exception. */
  recentAccuracy: number[];
  /** Consecutive countable sessions below the drop threshold. */
  consecutiveLow: number;
  trickyWords: string[];
}

export interface ProgressionDecision {
  move: StageMove;
  fromStage: number;
  toStage: number;
  mode: ProgressionMode;
  /** Internal only. Never surfaced to child or parent. */
  rationale: string;
  /**
   * Always true. Present as an explicit assertion rather than a comment,
   * because "the child must never notice" is the requirement most likely to be
   * quietly broken by a future change.
   */
  silentToChild: true;
}
