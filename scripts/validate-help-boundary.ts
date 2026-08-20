/* Validates whether the LIVE help-decision (combineVerdicts -> needsHelp,
 * what actually drives the correction UI a child sees today) agrees with
 * the RULES-LAYER decision (adapter -> WordSignal -> interpretSession() ->
 * correct/stumbled/missed, what would feed progression) across a
 * representative range of the same underlying evidence.
 *
 *   node scripts/validate-help-boundary.ts
 *
 * Analysis only. Does not touch persistence, progression application, the
 * help ladder UI, or /read. Does not retune VERDICT_THRESHOLDS,
 * DEFAULT_INTERPRET_CONFIG, or config.json's confidence_floor — see
 * docs/HELP_BOUNDARY_VALIDATION.md for why a single number can't fully
 * reconcile these two systems, and for the proposed (NOT YET APPLIED,
 * NOT YET CONFIRMED) resolution.                                          */

import { combineVerdicts, type DecodeResult } from '../lib/reading-verdict.ts';
import { toWordSignals } from '../lib/reading-signal-adapter.ts';
import { interpretSession } from '../reading-tutor/src/interpret.ts';
import type { WordScore } from '../lib/pronunciation.ts';
import type { SessionInput, WordSignal } from '../reading-tutor/src/types.ts';

interface Case {
  bucket: string;
  word: WordScore;
  decode: DecodeResult | null;
  note: string;
}

/* Real words from the actual demo chapters in lib/chapters.ts
 * (STORY_SKELETONS[0] and [1] — the 'dogs'/'unseen' skeletons), each given
 * a realistic-but-constructed score profile chosen to land in a specific
 * region of the decision space. This is the point of the exercise: the
 * SAME kind of Azure/MDD numbers lib/pronunciation.ts and
 * /api/reading/decode actually produce, deliberately spread across the
 * range that matters rather than randomly sampled. */
const CASES: Case[] = [
  // --- Bucket 1: clearly correct — both systems should agree: no help ---
  {
    bucket: 'clearly correct',
    word: { word: 'Rex', accuracy: 92, errorType: 'None', offsetMs: 300, durationMs: 280,
      phonemes: [{ phoneme: 'r', accuracy: 90 }, { phoneme: 'ɛ', accuracy: 95 }, { phoneme: 'ks', accuracy: 91 }] },
    decode: { recognized: 'rex', words: [{ word: 'rex', per: 0.08, score: 90, expected: 'r ɛ k s', heard: 'r ɛ k s' }], sentence_score: 90 },
    note: 'clean read, both graders agree',
  },
  {
    bucket: 'clearly correct',
    word: { word: 'sat', accuracy: 96, errorType: 'None', offsetMs: 250, durationMs: 260,
      phonemes: [{ phoneme: 's', accuracy: 95 }, { phoneme: 'æ', accuracy: 97 }, { phoneme: 't', accuracy: 96 }] },
    decode: { recognized: 'sat', words: [{ word: 'sat', per: 0.05, score: 94, expected: 's æ t', heard: 's æ t' }], sentence_score: 94 },
    note: 'clean read, both graders agree',
  },

  // --- Bucket 2: clearly wrong — both systems should agree: needs help ---
  {
    bucket: 'clearly wrong',
    word: { word: 'shadow', accuracy: 18, errorType: 'Mispronunciation', offsetMs: 250, durationMs: 500,
      phonemes: [{ phoneme: 'ʃ', accuracy: 20 }, { phoneme: 'æ', accuracy: 15 }, { phoneme: 'd', accuracy: 22 }, { phoneme: 'oʊ', accuracy: 12 }] },
    decode: { recognized: 'sadow', words: [{ word: 'shadow', per: 0.7, score: 15, expected: 'ʃ æ d oʊ', heard: 's æ d oʊ' }], sentence_score: 15 },
    note: 'genuinely bad read, both graders agree',
  },
  {
    bucket: 'clearly wrong',
    word: { word: 'bright', accuracy: 22, errorType: 'Mispronunciation', offsetMs: 800, durationMs: 450,
      phonemes: [{ phoneme: 'b', accuracy: 40 }, { phoneme: 'r', accuracy: 15 }, { phoneme: 'aɪ', accuracy: 18 }, { phoneme: 't', accuracy: 30 }] },
    decode: { recognized: 'bite', words: [{ word: 'bright', per: 0.65, score: 25, expected: 'b r aɪ t', heard: 'b aɪ t' }], sentence_score: 25 },
    note: 'genuinely bad read, both graders agree',
  },

  // --- Bucket 3: omission — both should agree: needs help / missed ---
  {
    bucket: 'omission',
    word: { word: 'calm', accuracy: null, errorType: 'Omission', offsetMs: null, durationMs: null, phonemes: [] },
    decode: null,
    note: 'skipped outright',
  },

  // --- Bucket 4: THE ORIGINAL BUG. Word accuracy clears interpretSession's
  // 0.35 floor, but phoneme-minimum + MDD both object -> live flags,
  // rules layer says correct. ---
  {
    bucket: 'live flags / rules says correct (accuracy dimension)',
    word: { word: 'raced', accuracy: 38, errorType: 'Mispronunciation', offsetMs: 650, durationMs: 410,
      phonemes: [{ phoneme: 'r', accuracy: 85 }, { phoneme: 'eɪ', accuracy: 22 }, { phoneme: 's', accuracy: 40 }, { phoneme: 't', accuracy: 45 }] },
    decode: { recognized: 'rest', words: [{ word: 'raced', per: 0.55, score: 35, expected: 'r eɪ s t', heard: 'r ɛ s t' }], sentence_score: 35 },
    note: 'the case that surfaced this whole investigation (Phase 3)',
  },
  {
    bucket: 'live flags / rules says correct (accuracy dimension)',
    word: { word: 'still', accuracy: 52, errorType: 'Mispronunciation', offsetMs: 900, durationMs: 380,
      phonemes: [{ phoneme: 's', accuracy: 88 }, { phoneme: 't', accuracy: 30 }, { phoneme: 'ɪ', accuracy: 25 }, { phoneme: 'l', accuracy: 60 }] },
    decode: { recognized: 'stiw', words: [{ word: 'still', per: 0.5, score: 42, expected: 's t ɪ l', heard: 's t ɪ w' }], sentence_score: 42 },
    note: 'word accuracy 52 looks comfortably fine; phoneme-min 25 + MDD 42 say otherwise',
  },
  {
    bucket: 'live flags / rules says correct (accuracy dimension)',
    word: { word: 'began', accuracy: 40, errorType: 'Mispronunciation', offsetMs: 250, durationMs: 420,
      phonemes: [{ phoneme: 'b', accuracy: 70 }, { phoneme: 'ɪ', accuracy: 20 }, { phoneme: 'g', accuracy: 35 }, { phoneme: 'æ', accuracy: 65 }, { phoneme: 'n', accuracy: 68 }] },
    decode: { recognized: 'bigan', words: [{ word: 'began', per: 0.48, score: 48, expected: 'b ɪ g æ n', heard: 'b ɪ g æ n' }], sentence_score: 48 },
    note: 'just above the 0.35 floor (0.40); both graders still object',
  },

  // --- Bucket 5: the OTHER direction. Word accuracy fails the 0.35 floor,
  // but only ONE grader objects (live requires BOTH) -> rules flags,
  // live says fine. ---
  {
    bucket: 'rules flags / live says fine (accuracy dimension)',
    word: { word: 'kept', accuracy: 30, errorType: 'Mispronunciation', offsetMs: 700, durationMs: 300,
      phonemes: [{ phoneme: 'k', accuracy: 65 }, { phoneme: 'ɛ', accuracy: 60 }, { phoneme: 'p', accuracy: 62 }, { phoneme: 't', accuracy: 58 }] },
    decode: { recognized: 'kept', words: [{ word: 'kept', per: 0.25, score: 75, expected: 'k ɛ p t', heard: 'k ɛ p t' }], sentence_score: 75 },
    note: 'low word score (30) but phoneme-min 58 and MDD 75 both clear their bars — a harsh word score the phoneme/decode evidence does not corroborate',
  },
  {
    bucket: 'rules flags / live says fine (accuracy dimension)',
    word: { word: 'loud', accuracy: 33, errorType: 'Mispronunciation', offsetMs: 250, durationMs: 340,
      phonemes: [{ phoneme: 'l', accuracy: 70 }, { phoneme: 'aʊ', accuracy: 55 }, { phoneme: 'd', accuracy: 60 }] },
    decode: { recognized: 'loud', words: [{ word: 'loud', per: 0.42, score: 58, expected: 'l aʊ d', heard: 'l aʊ d' }], sentence_score: 58 },
    note: 'MDD alone would object (58<70) but phoneme-min (55) clears 50 — live needs BOTH, so it lets this through',
  },

  // --- Bucket 6: timing dimension. High accuracy, both graders happy, but
  // slow/hesitant. Rules flags via a dimension live does not measure AT
  // ALL. This disagreement is structural, not a threshold problem. ---
  {
    bucket: 'rules flags / live has no opinion (timing dimension)',
    word: { word: 'sun', accuracy: 91, errorType: 'None', offsetMs: 2400, durationMs: 320,
      phonemes: [{ phoneme: 's', accuracy: 90 }, { phoneme: 'ʌ', accuracy: 92 }, { phoneme: 'n', accuracy: 91 }] },
    decode: { recognized: 'sun', words: [{ word: 'sun', per: 0.1, score: 88, expected: 's ʌ n', heard: 's ʌ n' }], sentence_score: 88 },
    note: 'accuracy fine, but a 1500ms hesitation before starting the word (gap_before_ms) — set below',
    // gap injected via offsetMs relative to a previous-word clock; see buildGapCase()
  },
  {
    bucket: 'rules flags / live has no opinion (timing dimension)',
    word: { word: 'small', accuracy: 87, errorType: 'None', offsetMs: 500, durationMs: 2100,
      phonemes: [{ phoneme: 's', accuracy: 86 }, { phoneme: 'm', accuracy: 88 }, { phoneme: 'ɔː', accuracy: 85 }, { phoneme: 'l', accuracy: 89 }] },
    decode: { recognized: 'small', words: [{ word: 'small', per: 0.13, score: 85, expected: 's m ɔː l', heard: 's m ɔː l' }], sentence_score: 85 },
    note: 'sounded out slowly (2100ms) but accurately — both graders happy, rules flags on duration alone',
  },

  // --- Bucket 7: boundary ties, exactly at each threshold. Checks the
  // thresholds behave consistently (both use strict "<") at the edges. ---
  {
    bucket: 'boundary tie (exactly at threshold — should AGREE: fine)',
    word: { word: 'came', accuracy: 35, errorType: 'None', offsetMs: 600, durationMs: 300,
      phonemes: [{ phoneme: 'k', accuracy: 60 }, { phoneme: 'eɪ', accuracy: 50 }, { phoneme: 'm', accuracy: 55 }] },
    decode: { recognized: 'came', words: [{ word: 'came', per: 0.3, score: 70, expected: 'k eɪ m', heard: 'k eɪ m' }], sentence_score: 70 },
    note: 'accuracy=35 (not <0.35), phoneme-min=50 (not <50), MDD=70 (not <70) — every threshold exactly met, none crossed',
  },
  {
    bucket: 'boundary tie (one unit below — should AGREE: needs help)',
    word: { word: 'back', accuracy: 34, errorType: 'Mispronunciation', offsetMs: 600, durationMs: 300,
      phonemes: [{ phoneme: 'b', accuracy: 60 }, { phoneme: 'æ', accuracy: 49 }, { phoneme: 'k', accuracy: 55 }] },
    decode: { recognized: 'bat', words: [{ word: 'back', per: 0.35, score: 69, expected: 'b æ k', heard: 'b æ t' }], sentence_score: 69 },
    note: 'accuracy 34, phoneme-min 49, MDD 69 — every threshold crossed by exactly one unit',
  },

  // --- Bucket 8: MDD service down. Live falls back to a DIFFERENT,
  // looser threshold (min-phoneme<40 instead of the combined <50+<70).
  // Same word, same phoneme evidence, different live verdict depending on
  // infrastructure state that the rules-layer confidence never sees. ---
  {
    bucket: 'infra-dependent (MDD down changes the LIVE threshold, not the rules one)',
    word: { word: 'move', accuracy: 30, errorType: 'Mispronunciation', offsetMs: 900, durationMs: 340,
      phonemes: [{ phoneme: 'm', accuracy: 60 }, { phoneme: 'uː', accuracy: 45 }, { phoneme: 'v', accuracy: 50 }] },
    decode: null, // MDD service unavailable tonight
    note: 'phoneme-min 45 clears the Azure-only fallback (needs <40) so live says fine; rules (confidence 0.30<0.35) still flags it',
  },
];

function buildSentence(index: number, refText: string, w: WordScore, priorWords: WordScore[] = []) {
  // For the two timing cases, chain a plausible previous word so
  // gap_before_ms comes out to the intended ~1500ms hesitation rather than
  // "first word in the take" (which measures from listening-start instead).
  const words = [...priorWords, w];
  const { sentence } = (() => {
    const mod = toWordSignals(words);
    return { sentence: { index, text: refText, words: mod.signals.slice(-1), assisted: false, reread: false } };
  })();
  return sentence;
}

const PRIOR: WordScore = { word: 'the', accuracy: 90, errorType: 'None', offsetMs: 100, durationMs: 300, phonemes: [] };

console.log('bucket'.padEnd(58), 'word'.padEnd(10), 'acc'.padEnd(5), 'minPh'.padEnd(6), 'mdd'.padEnd(5), 'LIVE'.padEnd(10), 'RULES'.padEnd(10), 'AGREE?');
console.log('-'.repeat(130));

let agreeCount = 0;
let disagreeCount = 0;
const disagreements: string[] = [];
const results: { c: Case; liveNeedsHelp: boolean; signal: WordSignal }[] = [];

for (const c of CASES) {
  const isTimingCase = c.word.word === 'sun' || c.word.word === 'small';
  const wordForGap: WordScore = c.word.word === 'sun'
    ? { ...c.word, offsetMs: (PRIOR.offsetMs! + PRIOR.durationMs!) + 1500 } // 1500ms gap
    : c.word;

  // LIVE: combineVerdicts, exactly as app/read/page.tsx feeds it (reference-
  // order array; single word here since we're isolating one word at a time).
  const liveVerdicts = combineVerdicts([wordForGap], c.decode);
  const liveNeedsHelp = liveVerdicts[0].needsHelp;

  // RULES: adapter -> one-word SentenceResult -> one-sentence SessionInput
  // -> interpretSession(), exactly the Phase 3 path.
  const sentence = isTimingCase
    ? buildSentence(0, wordForGap.word, wordForGap, [PRIOR])
    : buildSentence(0, wordForGap.word, wordForGap);
  const session: SessionInput = {
    childId: 'validation', sessionId: 'validation-' + c.word.word, stage: 2,
    chapterId: 'validation', isBookshelfReread: false, startedAt: new Date().toISOString(),
    sentences: [sentence],
  };
  const reading = interpretSession(session);
  const outcome = reading.words.find((w) => w.word === c.word.word)!;
  const rulesTricky = outcome.verdict === 'stumbled' || outcome.verdict === 'missed';

  const agree = liveNeedsHelp === rulesTricky;
  if (agree) agreeCount++; else disagreeCount++;

  const minPh = wordForGap.phonemes.length
    ? Math.min(...wordForGap.phonemes.map((p) => p.accuracy).filter((a): a is number => a != null))
    : null;

  console.log(
    c.bucket.padEnd(58),
    c.word.word.padEnd(10),
    String(wordForGap.accuracy ?? '—').padEnd(5),
    String(minPh ?? '—').padEnd(6),
    String(c.decode?.words[0]?.score ?? '—').padEnd(5),
    (liveNeedsHelp ? 'needsHelp' : 'fine').padEnd(10),
    (rulesTricky ? outcome.verdict : 'correct').padEnd(10),
    agree ? 'agree' : '*** DISAGREE',
  );

  if (!agree) {
    disagreements.push(
      `  ${c.word.word.padEnd(10)} live=${liveNeedsHelp ? 'needsHelp' : 'fine'} rules=${rulesTricky ? outcome.verdict : 'correct'}` +
      ` — ${outcome.reason} — ${c.note}`,
    );
  }

  results.push({ c, liveNeedsHelp, signal: sentence.words[0] });
}

console.log('\n' + '='.repeat(80));
console.log(`${agreeCount} agree, ${disagreeCount} disagree, out of ${CASES.length} cases`);
console.log('\nDisagreements, with the actual reason interpretSession() gave:');
for (const d of disagreements) console.log(d);

// --- Simulation of the PROPOSED fix, for illustration only. NOT applied to
// lib/reading-signal-adapter.ts — see docs/HELP_BOUNDARY_VALIDATION.md.
// Proposal: when live's combineVerdicts() already says needsHelp for a
// word, the adapter should never let a subsequently-computed word-level
// confidence override that into a false 'correct'. Simulated here as
// "confidence = 0 whenever liveNeedsHelp", leaving every other case's
// confidence exactly as the real adapter already computes it. ---
console.log('\n' + '='.repeat(80));
console.log('SIMULATION of the proposed fix (NOT applied to the adapter — illustration only)');
console.log('='.repeat(80));

let simAgree = 0, simDisagree = 0;
const simDisagreements: string[] = [];

for (const { c, liveNeedsHelp, signal } of results) {
  const simulatedSignal: WordSignal = liveNeedsHelp ? { ...signal, confidence: 0 } : signal;
  const session: SessionInput = {
    childId: 'sim', sessionId: 'sim-' + c.word.word, stage: 2, chapterId: 'sim',
    isBookshelfReread: false, startedAt: new Date().toISOString(),
    sentences: [{ index: 0, text: c.word.word, words: [simulatedSignal], assisted: false, reread: false }],
  };
  const reading = interpretSession(session);
  const outcome = reading.words[0];
  const rulesTricky = outcome.verdict === 'stumbled' || outcome.verdict === 'missed';
  const agree = liveNeedsHelp === rulesTricky;
  if (agree) simAgree++; else simDisagree++;
  if (!agree) {
    simDisagreements.push(`  ${c.word.word.padEnd(10)} live=${liveNeedsHelp ? 'needsHelp' : 'fine'} rules=${rulesTricky ? outcome.verdict : 'correct'} — ${c.note}`);
  }
}

console.log(`${simAgree} agree, ${simDisagree} disagree, out of ${CASES.length} cases (was ${agreeCount}/${disagreeCount} before the simulated fix)`);
console.log('\nRemaining disagreements under the proposal (these are the ones being proposed as INTENTIONAL, not fixed):');
for (const d of simDisagreements) console.log(d);

console.log(
  '\nSee docs/HELP_BOUNDARY_VALIDATION.md for the analysis of WHY each',
  'disagreement happens, the product-question answer, and the PROPOSED',
  '(not yet applied) resolution.',
);
