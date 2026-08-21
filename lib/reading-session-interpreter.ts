/* The one place the Class A intervention override lives.
 *
 * lib/reading-signal-adapter.ts translates measurements. reading-tutor's
 * interpret.ts judges them, unmodified, exactly as it always has. Neither
 * file knows about "live already intervened on this word" — this file is
 * where that fact gets applied, as an explicit post-processing pass over
 * interpretSession()'s own output, never as a change to interpret.ts or to
 * WordSignal itself.
 *
 * See docs/HELP_BOUNDARY_VALIDATION.md for why: forcing WordSignal.confidence
 * to 0 for these words (the earlier, rejected approach) fabricated a
 * measurement — a debugger looking at `confidence: 0` on `raced` would have
 * no way to know Azure actually scored it 0.38. The real measurement stays
 * on WordSignal, untouched. The judgment travels next to it, in a separate
 * `SessionIntervention` structure, and is applied here, once, as a hard
 * override: a word live already intervened on can never be `correct` or
 * land in `cleanWords`, no matter what its confidence score says. */

import { interpretSession, DEFAULT_INTERPRET_CONFIG, type InterpretConfig } from '../reading-tutor/src/interpret.ts';
import type { SessionInput, SessionReading, WordOutcome } from '../reading-tutor/src/types.ts';

/** interventions[sentenceIndex][wordIndex] — same shape/indexing as
 *  SessionInput.sentences[i].words[j], so it lines up with a session by
 *  position, not by word text (real chapters repeat words, e.g.
 *  "looked...looked", so text-matching would misalign). Callers assembling
 *  a SessionInput from lib/reading-signal-adapter.ts's toSentenceResult()
 *  already have this per sentence as AdaptedSentence.interventions — this
 *  type just says how to stack those into a whole-session shape. */
export type SessionIntervention = boolean[][];

function noIntervention(session: SessionInput): SessionIntervention {
  return session.sentences.map((s) => s.words.map(() => false));
}

/** Calls interpretSession() completely unmodified, then overrides only the
 *  words live already intervened on: if judge() called one of them
 *  'correct', it becomes 'stumbled' instead. Nothing else about
 *  interpretSession()'s logic — the 0.35 floor, the timing checks, the
 *  bookshelf/assisted-heavy/too-few-words exclusion rules — is touched or
 *  duplicated here. When no interventions apply to any word already called
 *  'correct' (the common case), this returns interpretSession()'s own
 *  result object unchanged. */
export function interpretSessionWithIntervention(
  session: SessionInput,
  interventions: SessionIntervention = noIntervention(session),
  cfg: InterpretConfig = DEFAULT_INTERPRET_CONFIG,
  previouslyTricky: string[] = [],
): SessionReading {
  const base = interpretSession(session, cfg, previouslyTricky);

  // Flatten in the exact same order interpretSession() itself iterates
  // sentences/words in when it builds `outcomes` (nested for-of, sentence
  // order then word order) — base.words is positionally aligned to that,
  // and this must match it 1:1.
  const flatIntervention: boolean[] = [];
  for (let si = 0; si < session.sentences.length; si++) {
    const wordCount = session.sentences[si].words.length;
    for (let wi = 0; wi < wordCount; wi++) {
      flatIntervention.push(interventions[si]?.[wi] ?? false);
    }
  }

  let changed = false;
  const words: WordOutcome[] = base.words.map((o, i) => {
    if (o.verdict === 'correct' && flatIntervention[i]) {
      changed = true;
      return { ...o, verdict: 'stumbled', reason: `live intervention overrides confidence (was: ${o.reason})` };
    }
    return o;
  });

  if (!changed) return base;

  // Re-derive exactly what interpret.ts itself derives from `words` —
  // same filters, same dedup, same order — never a second, independently
  // written aggregation.
  const counted = words.filter((o) => o.verdict !== 'excluded');
  const correctCount = counted.filter((o) => o.verdict === 'correct').length;
  const accuracy = counted.length > 0 ? correctCount / counted.length : null;

  const trickyWords = [...new Set(
    counted.filter((o) => o.verdict === 'stumbled' || o.verdict === 'missed').map((o) => o.word),
  )];

  const trickyBefore = new Set(previouslyTricky);
  const cleanWords = [...new Set(
    counted.filter((o) => o.verdict === 'correct' && trickyBefore.has(o.word)).map((o) => o.word),
  )];

  return {
    ...base,
    words,
    accuracy,
    countedWords: counted.length,
    excludedWords: words.length - counted.length,
    trickyWords,
    cleanWords,
  };
}
