/**
 * Decides whether tomorrow's chapter gets harder, stays put, or gets easier.
 *
 * Two modes:
 *
 *   placement - the first few sessions, where we do not yet know the child's
 *               level and need to find it fast. Moves in bigger steps.
 *   steady    - everything after, using the rolling three-session window.
 *
 * Placement exists because the marketing site promises the app "finds their
 * level over the first few sessions". A three-session rolling window that moves
 * one stage at a time cannot do that: a child placed at stage 1 who actually
 * reads at stage 6 would need fifteen sessions of boredom to get there.
 *
 * Every move is silent. There is no message, no change in tone, no
 * acknowledgement of any kind. The story simply gets easier or harder.
 */

import type {
  ChildProgress,
  ProgressionDecision,
  SessionReading,
} from './types.js';

export interface ProgressionConfig {
  minStage: number;
  maxStage: number;

  /** Steady state: rolling window size. */
  windowSize: number;
  /** Mean accuracy at or above this advances one stage. */
  advanceAt: number;
  /** Below this counts as a low session. */
  dropBelow: number;
  /** How many consecutive low sessions before dropping back. */
  consecutiveLowToDrop: number;

  /** Placement: sessions before switching to steady state. */
  placementSessions: number;
  /** Placement: a single session at or above this jumps two stages. */
  placementBigJumpAt: number;
  /** Placement: at or above this jumps one stage. */
  placementJumpAt: number;
  /** Placement: below this drops two stages. */
  placementBigDropBelow: number;
  /** Placement: below this drops one stage. */
  placementDropBelow: number;
}

export const DEFAULT_PROGRESSION_CONFIG: ProgressionConfig = {
  minStage: 1,
  maxStage: 10,

  windowSize: 3,
  advanceAt: 0.95,
  // NOTE: the original spec said "95%+ advance, 90-94% hold, below 85%
  // sustained drop" and left 85-89% undefined. Treated as hold, which is the
  // conservative reading - a child in that band keeps practising at the same
  // level rather than being moved in either direction.
  dropBelow: 0.85,
  consecutiveLowToDrop: 2,

  placementSessions: 5,
  placementBigJumpAt: 0.97,
  placementJumpAt: 0.9,
  placementBigDropBelow: 0.7,
  placementDropBelow: 0.85,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function decide(
  from: number,
  to: number,
  mode: ProgressionDecision['mode'],
  rationale: string,
): ProgressionDecision {
  const bounded = clamp(to, DEFAULT_PROGRESSION_CONFIG.minStage, DEFAULT_PROGRESSION_CONFIG.maxStage);
  return {
    move: bounded > from ? 'advance' : bounded < from ? 'drop' : 'hold',
    fromStage: from,
    toStage: bounded,
    mode,
    rationale,
    silentToChild: true,
  };
}

/**
 * Seeds a new child's stage from what the parent told us at signup.
 *
 * Deliberately starts one stage BELOW the parent's estimate. Parents overestimate,
 * and the cost of starting too easy is one slightly dull evening, while the cost
 * of starting too hard is a child who decides reading is not for them.
 */
export function initialStage(parentEstimate: number, cfg = DEFAULT_PROGRESSION_CONFIG): number {
  return clamp(parentEstimate - 1, cfg.minStage, cfg.maxStage);
}

export function applySession(
  progress: ChildProgress,
  reading: SessionReading,
  cfg: ProgressionConfig = DEFAULT_PROGRESSION_CONFIG,
): { progress: ChildProgress, decision: ProgressionDecision } {
  const next: ChildProgress = {
    ...progress,
    sessionsCompleted: progress.sessionsCompleted + 1,
    recentAccuracy: [...progress.recentAccuracy],
    trickyWords: [...new Set([...reading.trickyWords])],
  };

  // A session we cannot read anything into moves nobody. This is the rule that
  // stops a tired evening, a session the child was read through, or a bookshelf
  // reread from dragging a child's level around.
  if (reading.excludedFromProgression || reading.accuracy === null) {
    return {
      progress: next,
      decision: decide(
        progress.stage,
        progress.stage,
        progress.mode,
        `session not counted: ${reading.excludedReason ?? 'no countable words'}`,
      ),
    };
  }

  const acc = reading.accuracy;
  next.recentAccuracy = [...next.recentAccuracy, acc].slice(-cfg.windowSize);

  // --- placement -----------------------------------------------------------
  if (progress.mode === 'placement') {
    let delta = 0;
    let why: string;

    if (acc >= cfg.placementBigJumpAt) {
      delta = 2;
      why = 'placement: well above level, jumping two stages';
    } else if (acc >= cfg.placementJumpAt) {
      delta = 1;
      why = 'placement: above level, up one stage';
    } else if (acc < cfg.placementBigDropBelow) {
      delta = -2;
      why = 'placement: well below level, dropping two stages';
    } else if (acc < cfg.placementDropBelow) {
      delta = -1;
      why = 'placement: below level, down one stage';
    } else {
      why = 'placement: level looks right, holding';
    }

    // Two holds in a row means we have found the level. Leave placement early
    // rather than burning the remaining sessions bouncing around it.
    const settled =
      delta === 0 &&
      next.recentAccuracy.length >= 2 &&
      next.recentAccuracy.slice(-2).every((a) => a >= cfg.placementBigDropBelow && a < cfg.placementJumpAt);

    if (settled || next.sessionsCompleted >= cfg.placementSessions) {
      next.mode = 'steady';
      // Start the steady window clean. Placement accuracies were measured at
      // stages the child has since moved off, so they say nothing useful about
      // performance at the stage they are about to settle on.
      next.recentAccuracy = [];
      next.consecutiveLow = 0;
    }

    next.stage = clamp(progress.stage + delta, cfg.minStage, cfg.maxStage);
    return { progress: next, decision: decide(progress.stage, next.stage, 'placement', why) };
  }

  // --- steady state --------------------------------------------------------
  next.consecutiveLow = acc < cfg.dropBelow ? progress.consecutiveLow + 1 : 0;

  if (next.consecutiveLow >= cfg.consecutiveLowToDrop) {
    next.stage = clamp(progress.stage - 1, cfg.minStage, cfg.maxStage);
    next.consecutiveLow = 0;
    next.recentAccuracy = [];
    return {
      progress: next,
      decision: decide(
        progress.stage,
        next.stage,
        'steady',
        `${cfg.consecutiveLowToDrop} consecutive sessions below ${cfg.dropBelow}`,
      ),
    };
  }

  // Need a full window before advancing. Advancing on one good night moves
  // children up on noise.
  if (next.recentAccuracy.length < cfg.windowSize) {
    return {
      progress: next,
      decision: decide(
        progress.stage,
        progress.stage,
        'steady',
        `window not full (${next.recentAccuracy.length}/${cfg.windowSize})`,
      ),
    };
  }

  const mean = next.recentAccuracy.reduce((a, b) => a + b, 0) / next.recentAccuracy.length;

  if (mean >= cfg.advanceAt) {
    next.stage = clamp(progress.stage + 1, cfg.minStage, cfg.maxStage);
    next.recentAccuracy = [];
    return {
      progress: next,
      decision: decide(progress.stage, next.stage, 'steady', `window mean at or above ${cfg.advanceAt}`),
    };
  }

  return {
    progress: next,
    decision: decide(progress.stage, progress.stage, 'steady', 'window mean in the holding band'),
  };
}

/** The only fields that should reach Firestore. No score, by construction. */
export function toPersistable(p: ChildProgress) {
  return {
    childId: p.childId,
    stage: p.stage,
    sessionsCompleted: p.sessionsCompleted,
    mode: p.mode,
    consecutiveLow: p.consecutiveLow,
    trickyWords: p.trickyWords,
    // recentAccuracy is the one number that has to survive between nightly runs
    // for the rolling window to work at all. Store it under a name nobody would
    // ever put on a screen, and never expose it through any read API.
    _windowInternal: p.recentAccuracy,
  };
}
