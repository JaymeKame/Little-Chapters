/**
 * End-to-end checks on synthetic sessions.
 *
 * No API key needed. The LLM is mocked with fixed responses so the validators
 * and the retry loop can be exercised deterministically.
 */

import { interpretSession, toPersistable as readingToPersistable } from '../src/interpret.js';
import { applySession, initialStage, DEFAULT_PROGRESSION_CONFIG } from '../src/progression.js';
import { validatePhonics, validateContent } from '../src/validators.js';
import { generateChapter, type LlmClient } from '../src/generate.js';
import { SKELETONS, skeletonsForStage, slotsFor } from '../src/skeletons.js';
import {
  slotOptions, assignSlots, renderBeats, unresolvedSlots, canRunAtStage,
} from '../src/slots.js';
import { allowedWordsForStage, CONTENT_BLOCKLIST, HUMAN_NOUNS } from '../content/stages.js';
import type { ChildProgress, SentenceResult, SessionInput, WordSignal } from '../src/types.js';
import { adaptTutorDraft } from '../../lib/chapters.ts';
import { toWordSignals, toSentenceResult } from '../../lib/reading-signal-adapter.ts';
import { interpretSessionWithIntervention, type SessionIntervention } from '../../lib/reading-session-interpreter.ts';
import { HELP_LADDER, rungLine, graphemeCueFor } from '../../lib/help-ladder.ts';
import type { WordScore } from '../../lib/pronunciation.ts';
import type { DecodeResult } from '../../lib/reading-verdict.ts';

let pass = 0, fail = 0;
const ok = (cond: boolean, label: string, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${extra ? ' -> ' + extra : ''}`); }
};
const section = (s: string) => console.log(`\n${s}`);

// --- signal builders --------------------------------------------------------

const clean = (word: string): WordSignal =>
  ({ word, confidence: 0.9, duration_ms: 400, gap_before_ms: 120, heard: true });
const mumbled = (word: string): WordSignal =>
  ({ word, confidence: 0.2, duration_ms: 500, gap_before_ms: 150, heard: true });
const soundedOut = (word: string): WordSignal =>
  ({ word, confidence: 0.8, duration_ms: 2400, gap_before_ms: 200, heard: true });
const stalled = (word: string): WordSignal =>
  ({ word, confidence: 0.85, duration_ms: 450, gap_before_ms: 2600, heard: true });
const silent = (word: string): WordSignal =>
  ({ word, confidence: 0, duration_ms: 0, gap_before_ms: 4000, heard: false });

let sentenceCounter = 0;
function sentence(
  words: WordSignal[],
  opts: { assisted?: boolean; reread?: boolean } = {},
): SentenceResult {
  return {
    index: sentenceCounter++,
    text: words.map((w) => w.word).join(' '),
    words,
    assisted: opts.assisted ?? false,
    reread: opts.reread ?? false,
  };
}

function session(sentences: SentenceResult[], opts: Partial<SessionInput> = {}): SessionInput {
  sentenceCounter = 0;
  return {
    childId: 'c1', sessionId: 's' + Math.random().toString(36).slice(2, 7),
    stage: 2, chapterId: 'ch1', isBookshelfReread: false,
    startedAt: new Date().toISOString(), sentences, ...opts,
  };
}

const six = (f: (w: string) => WordSignal) =>
  ['the', 'cat', 'sat', 'on', 'my', 'mat'].map(f);

// --- 1. interpretation ------------------------------------------------------

section('Interpretation');
{
  const r = interpretSession(session([sentence(six(clean)), sentence(six(clean)), sentence(six(clean))]));
  ok(r.accuracy === 1, 'a clean session is 100%');
  ok(r.trickyWords.length === 0, 'a clean session has no tricky words');
}
{
  const r = interpretSession(session([
    sentence([...six(clean).slice(0, 4), mumbled('big'), silent('dog')]),
    sentence(six(clean)), sentence(six(clean)),
  ]));
  ok(r.trickyWords.includes('big'), 'a mumbled word is tricky');
  ok(r.trickyWords.includes('dog'), 'an unheard word is tricky');
  ok(r.accuracy !== null && r.accuracy < 1, 'accuracy drops below 1');
}
{
  const r = interpretSession(session([
    sentence([...six(clean).slice(0, 5), soundedOut('mat')]),
    sentence([...six(clean).slice(0, 5), stalled('mat')]),
    sentence(six(clean)),
  ]));
  ok(r.trickyWords.length === 1 && r.trickyWords[0] === 'mat',
     'sounding out and long pauses both flag as stumbled');
}

section('Exclusions - the rules that stop us punishing a bad night');
{
  // Three sentences read cleanly, two read TO the child. The assisted words are
  // all perfect signal, but must not inflate the number.
  const r = interpretSession(session([
    sentence(six(clean)), sentence(six(clean)), sentence(six(clean)),
    sentence(six(clean), { assisted: true }), sentence(six(clean), { assisted: true }),
  ]));
  ok(r.excludedWords === 12, 'assisted sentences are excluded from the count', String(r.excludedWords));
  ok(r.countedWords === 18, 'only unassisted words count', String(r.countedWords));
}
{
  // Same session, but the child stumbled badly on the sentences they DID read.
  // Assisted words must not rescue the number either.
  const r = interpretSession(session([
    sentence(six(mumbled)), sentence(six(mumbled)),
    sentence(six(clean), { assisted: true }),
  ]));
  ok(r.accuracy === 0, 'perfect assisted sentences cannot inflate a bad night', String(r.accuracy));
}
{
  // Three of five sentences read to the child. The app did most of the reading,
  // so the night says nothing about the child's level.
  const r = interpretSession(session([
    sentence(six(mumbled)), sentence(six(mumbled)),
    sentence(six(clean), { assisted: true }),
    sentence(six(clean), { assisted: true }),
    sentence(six(clean), { assisted: true }),
  ]));
  ok(r.excludedFromProgression, 'an assisted-heavy session is excluded from progression');
  ok(r.excludedReason === 'assisted-heavy', 'and says why');
}
{
  // Boundary, documented deliberately: one sentence in three read to the child
  // still leaves a usable sample, so the session DOES count. If this ever feels
  // wrong in testing, assistedHeavyThreshold is the dial.
  const r = interpretSession(session([
    sentence(six(mumbled)), sentence(six(mumbled)),
    sentence(six(clean), { assisted: true }),
  ]));
  ok(!r.excludedFromProgression, 'one assisted sentence in three still counts');
}
{
  const r = interpretSession(session([
    sentence(six(clean), { assisted: true }),
    sentence(six(clean), { reread: true }),
    sentence(six(clean)), sentence(six(clean)), sentence(six(clean)),
  ]));
  ok(r.words.filter((w) => w.excludedBecause === 'reread').length === 6,
     'the rung-3 reread is excluded - the child was just fed those words');
}
{
  const r = interpretSession(session(
    [sentence(six(clean)), sentence(six(clean)), sentence(six(clean))],
    { isBookshelfReread: true },
  ));
  ok(r.accuracy === 1, 'a bookshelf reread still computes an accuracy');
  ok(r.excludedFromProgression, 'but never moves the stage');
  ok(r.excludedReason === 'bookshelf-reread', 'and says why');
}

section('Scores never get persisted');
{
  const r = interpretSession(session([sentence(six(clean)), sentence(six(clean)), sentence(six(clean))]));
  const stored = readingToPersistable(r);
  ok(!('accuracy' in stored), 'toPersistable strips accuracy');
  ok(!JSON.stringify(stored).includes('"accuracy"'), 'nothing score-shaped survives serialisation');
}

// --- 2. progression ---------------------------------------------------------

section('Progression - steady state');

function fresh(stage: number, mode: ChildProgress['mode'] = 'steady'): ChildProgress {
  return { childId: 'c1', stage, sessionsCompleted: 10, mode, recentAccuracy: [], consecutiveLow: 0, trickyWords: [] };
}
function readingAt(acc: number, stage = 2) {
  // 100 countable words, so accuracy is exact to 1%. Using 20 words meant
  // readingAt(0.88) actually produced 0.90, which silently tested the wrong
  // side of a threshold.
  const total = 100, good = Math.round(acc * total);
  const words = [...Array(good).fill(0).map((_, i) => clean('w' + i)),
                 ...Array(total - good).fill(0).map((_, i) => silent('x' + i))];
  return interpretSession(session([
    sentence(words.slice(0, 34)), sentence(words.slice(34, 67)), sentence(words.slice(67)),
  ], { stage }));
}

{
  let p = fresh(2);
  const accs = [1, 1, 1];
  let last;
  for (const a of accs) ({ progress: p, decision: last } = applySession(p, readingAt(a)));
  ok(p.stage === 3, 'three sessions at 100% advance one stage', `stage ${p.stage}`);
  ok(last!.silentToChild === true, 'the move is marked silent');
}
{
  let p = fresh(5);
  let last;
  for (const a of [1, 1]) ({ progress: p, decision: last } = applySession(p, readingAt(a)));
  ok(p.stage === 5, 'two good sessions are not enough - window must be full', `stage ${p.stage}`);
  ok(last!.move === 'hold', 'and the decision is hold');
}
{
  let p = fresh(5);
  for (const a of [0.92, 0.92, 0.92]) ({ progress: p } = applySession(p, readingAt(a)));
  ok(p.stage === 5, '92% holds, neither up nor down');
}
{
  let p = fresh(5);
  for (const a of [0.87, 0.87, 0.87]) ({ progress: p } = applySession(p, readingAt(a)));
  ok(p.stage === 5, '87% holds - the gap the original spec left undefined');
}
{
  let p = fresh(5);
  let last;
  ({ progress: p } = applySession(p, readingAt(0.6)));
  ok(p.stage === 5, 'one bad night does not drop a child');
  ({ progress: p, decision: last } = applySession(p, readingAt(0.6)));
  ok(p.stage === 4, 'two consecutive bad nights drop one stage', `stage ${p.stage}`);
  ok(last!.silentToChild === true, 'the drop is silent');
}
{
  let p = fresh(1);
  for (const a of [0.5, 0.5, 0.5, 0.5]) ({ progress: p } = applySession(p, readingAt(a)));
  ok(p.stage === 1, 'cannot drop below stage 1');
}
{
  let p = fresh(10);
  for (const a of [1, 1, 1, 1, 1, 1]) ({ progress: p } = applySession(p, readingAt(a)));
  ok(p.stage === 10, 'cannot advance past stage 10');
}
{
  // The whole point of the exclusions: a run of assisted-heavy nights must not
  // drag a child down.
  let p = fresh(6);
  const assistedNight = interpretSession(session([
    sentence(six(mumbled)), sentence(six(clean), { assisted: true }), sentence(six(clean), { assisted: true }),
  ]));
  for (let i = 0; i < 5; i++) ({ progress: p } = applySession(p, assistedNight));
  ok(p.stage === 6, 'five assisted-heavy nights in a row leave the stage untouched', `stage ${p.stage}`);
}
{
  let p = fresh(6);
  const shelf = interpretSession(session(
    [sentence(six(clean)), sentence(six(clean)), sentence(six(clean))],
    { isBookshelfReread: true },
  ));
  for (let i = 0; i < 5; i++) ({ progress: p } = applySession(p, shelf));
  ok(p.stage === 6, 'five perfect bookshelf rereads do not advance a child', `stage ${p.stage}`);
}

section('Progression - cold start placement');
{
  ok(initialStage(4) === 3, 'we start one stage below the parent estimate');
  ok(initialStage(1) === 1, 'and never below stage 1');
}
{
  // A child seeded at stage 1 who actually reads at stage 6.
  let p: ChildProgress = { ...fresh(1, 'placement'), sessionsCompleted: 0 };
  let n = 0;
  while (p.mode === 'placement' && n < 10) {
    ({ progress: p } = applySession(p, readingAt(1)));
    n++;
  }
  ok(p.stage >= 5, 'placement climbs fast from a wrong seed', `reached stage ${p.stage} in ${n}`);
  ok(n <= DEFAULT_PROGRESSION_CONFIG.placementSessions,
     'and gets there inside the placement window', `${n} sessions`);
}
{
  // Compare against steady state, which is the whole reason placement exists.
  let p = fresh(1);
  let n = 0;
  while (p.stage < 5 && n < 40) { ({ progress: p } = applySession(p, readingAt(1))); n++; }
  ok(n >= 12, 'steady state would have taken far longer for the same child', `${n} sessions`);
}
{
  let p: ChildProgress = { ...fresh(8, 'placement'), sessionsCompleted: 0 };
  ({ progress: p } = applySession(p, readingAt(0.4)));
  ok(p.stage === 6, 'placement drops two stages when a child is well out of depth', `stage ${p.stage}`);
}
{
  let p: ChildProgress = { ...fresh(4, 'placement'), sessionsCompleted: 0 };
  for (let i = 0; i < 2; i++) ({ progress: p } = applySession(p, readingAt(0.88)));
  ok(p.mode === 'steady', 'two settled sessions exit placement early');
  ok(p.stage === 4, 'and leave the child where they belong');
  ok(p.recentAccuracy.length === 0, 'the steady window starts clean');
}

// --- 3. validators ----------------------------------------------------------

section('Phonics validator');
const cast = { childName: 'Sam', petName: 'Pip' };
{
  const r = validatePhonics(
    { sentences: ['Pip sat on my mat', 'Sam and I did not nap'], imagePrompt: '', summaryLine: '' },
    1, cast,
  );
  ok(r.ok, 'a legal stage 1 chapter passes', JSON.stringify(r.violations));
}
{
  const r = validatePhonics(
    { sentences: ['Sam saw a bright green dragon'], imagePrompt: '', summaryLine: '' },
    1, cast,
  );
  ok(!r.ok, 'off-level words are rejected');
  ok(r.offendingWords.includes('dragon'), 'and the offending word is logged', r.offendingWords.join(','));
}
{
  const r = validatePhonics(
    { sentences: ['Sam sat'], imagePrompt: '', summaryLine: '' },
    1, cast,
  );
  ok(!r.ok && r.violations.some((v) => v.rule === 'phonics/sentence-length'),
     'sentences shorter than the stage minimum are rejected');
}
{
  // Stage 3 words appearing in a stage 2 chapter: allowed, but only two of them.
  const r = validatePhonics(
    { sentences: ['Sam had a red rug', 'Pip hid on the rug', 'Sam ran to get him'], imagePrompt: '', summaryLine: '' },
    2, cast,
  );
  ok(!r.ok, 'more than two next-stage stretch words is rejected', JSON.stringify(r.violations.map(v=>v.detail)));
}

section('Content validator');
{
  const r = validateContent(
    { sentences: ['Sam and Pip sat on the mat'], imagePrompt: 'a cat on a mat', summaryLine: 'they sat' },
    cast,
  );
  ok(r.ok, 'the child and their pet are fine', JSON.stringify(r.violations));
}
{
  const r = validateContent(
    { sentences: ['Sam and his dad ran to the shop'], imagePrompt: '', summaryLine: '' },
    cast,
  );
  ok(!r.ok, 'another human is rejected');
  ok(r.offendingWords.includes('dad'), 'and named', r.offendingWords.join(','));
}
{
  const r = validateContent(
    { sentences: ['Sam met a big shark'], imagePrompt: '', summaryLine: '' },
    cast,
  );
  ok(!r.ok && r.offendingWords.includes('shark'), 'frightening content is rejected');
}
{
  const r = validateContent(
    { sentences: ['Sam ran to Boston with Pip'], imagePrompt: '', summaryLine: '' },
    cast,
  );
  ok(!r.ok && r.offendingWords.includes('Boston'), 'smuggled proper nouns are caught');
}
{
  const r = validateContent(
    { sentences: ['Sam sat'], imagePrompt: 'Sam and his mom', summaryLine: '' },
    cast,
  );
  ok(!r.ok, 'the image prompt is validated too, not just the sentences');
}

// --- 4. generator retry loop ------------------------------------------------

section('Generator');
{
  // Fails twice, then produces something legal. Proves the retry loop works and
  // that the rejection reasons get fed back.
  const responses = [
    JSON.stringify({ sentences: ['Sam saw a huge dragon today'], imagePrompt: 'x', summaryLine: 'y' }),
    'not json at all',
    JSON.stringify({
      sentences: ['Pip sat on my mat', 'Sam did nap in it', 'The fan is on my pad'],
      imagePrompt: 'a pin on a mat', summaryLine: 'Sam sat',
    }),
  ];
  const prompts: string[] = [];
  const llm: LlmClient = {
    async complete(prompt, attempt) { prompts.push(prompt); return responses[attempt - 1] ?? responses[2]; },
  };

  const res = await generateChapter({
    stage: 1, cast, interests: ['dogs', 'space', 'digging'],
    storySoFar: '', recentlyMissedWords: ['mat', 'pin'],
    skeleton: SKELETONS[0],
  }, llm);

  ok(res.ok, 'the generator eventually produces a legal chapter');
  ok(res.attempts === 3, 'after the expected number of attempts', String(res.attempts));
  ok(res.rejectionLog.length === 2, 'and logs both rejections');
  ok(res.rejectionLog[0].violations.some((v) => v.word === 'dragon'), 'logging the offending word');
  ok(prompts[1].includes('YOUR LAST ATTEMPT WAS REJECTED'), 'the retry prompt tells the model what failed');
  ok(prompts[1].includes('dragon'), 'and which word to avoid');
  ok(prompts[0].includes('mat'), 'recently missed words are woven into the prompt');
}
{
  const llm: LlmClient = { async complete() { return JSON.stringify({ sentences: ['Sam saw a dragon and a giant'], imagePrompt: '', summaryLine: '' }); } };
  const res = await generateChapter({
    stage: 1, cast, interests: [], storySoFar: '', recentlyMissedWords: [], skeleton: SKELETONS[0],
  }, llm, 3);
  ok(!res.ok, 'a model that never complies fails cleanly rather than shipping bad text');
  ok(res.rejectionLog.length === 3, 'with every attempt logged');
}

section('Skeletons');
{
  ok(SKELETONS.length >= 8, `${SKELETONS.length} skeletons defined`);
  ok(skeletonsForStage(1).length >= 2, 'at least two shapes work at stage 1', String(skeletonsForStage(1).length));
  ok(skeletonsForStage(10).length === SKELETONS.length, 'all shapes available by stage 10');
  ok(SKELETONS.every((s) => s.beats.length >= 5 && s.beats.length <= 8), 'every skeleton is 5-8 beats');
  ok(new Set(SKELETONS.map((s) => s.id)).size === SKELETONS.length, 'ids are unique');
  ok(SKELETONS.every((s) => s.cliffhangerNote.length > 40), 'every skeleton has a real ending instruction');
  ok(SKELETONS.every((s) => s.beats.some((b) => /\{\w+\}/.test(b))),
     'every skeleton actually has blanks in it');
}

section('Little Chapters adapter');
{
  const chapter = adaptTutorDraft(
    { childName: 'Sam', age: 6, interests: ['dogs'], createdAt: 1 },
    { sentences: ['Sam sat on a mat', 'Pip sat by Sam'], imagePrompt: 'Sam and Pip', summaryLine: 'Sam found a mat' },
    SKELETONS[0],
  );
  ok(chapter !== null, 'a draft with sentences adapts successfully');
  if (!chapter) throw new Error('adapter returned null for a valid draft');
  const empty = adaptTutorDraft(
    { childName: 'Sam', age: 6, interests: ['dogs'], createdAt: 1 },
    { sentences: [], imagePrompt: '', summaryLine: '' },
    SKELETONS[0],
  );
  ok(empty === null, 'a page-less draft is rejected instead of crashing the reader');
  ok(chapter.pages.length === 2, 'tutor sentences become Chapter pages');
  ok(chapter.pages.every((page) => typeof page.text === 'string' && Array.isArray(page.focusWords)), 'Chapter page shape is preserved');
  ok(chapter.cliffhanger[1] === 'To be continued tomorrow...', 'adapter preserves the cliffhanger contract');
}

section('Reading signal adapter - live speech layer -> WordSignal');
{
  // A representative take, not a synthetic edge case: a child reading
  // "Rex raced across the field." with one genuinely mispronounced word,
  // one long hesitation before a word, one word they sounded out slowly,
  // and one they skipped outright. Timings/scores are the kind of numbers
  // lib/pronunciation.ts actually produces (ms offsets, 0-100 accuracy,
  // per-phoneme detail), not round test numbers.
  const words: WordScore[] = [
    { word: 'Rex', accuracy: 92, errorType: 'None', offsetMs: 300, durationMs: 280,
      phonemes: [{ phoneme: 'r', accuracy: 90 }, { phoneme: 'ɛ', accuracy: 95 }, { phoneme: 'ks', accuracy: 91 }] },
    // Genuinely weak: low word score AND a badly-scored phoneme. This is the
    // "real mistake" case - both signals agree, so it SHOULD read as low
    // confidence.
    { word: 'raced', accuracy: 38, errorType: 'Mispronunciation', offsetMs: 650, durationMs: 410,
      phonemes: [{ phoneme: 'r', accuracy: 85 }, { phoneme: 'eɪ', accuracy: 22 }, { phoneme: 's', accuracy: 40 }, { phoneme: 't', accuracy: 45 }] },
    // High word accuracy but ONE weak phoneme (e.g. a slightly soft /k/) -
    // the case that proves confidence tracks the word score, not the
    // phoneme minimum, per the tiebreaker in the integration brief.
    { word: 'across', accuracy: 88, errorType: 'None', offsetMs: 2400, durationMs: 520,
      phonemes: [{ phoneme: 'ə', accuracy: 90 }, { phoneme: 'k', accuracy: 41 }, { phoneme: 'r', accuracy: 92 }, { phoneme: 'ɒ', accuracy: 89 }, { phoneme: 's', accuracy: 94 }] },
    // Skipped outright - LCS alignment already synthesized this Omission
    // (see lib/pronunciation.ts alignWords()), so there is no real timestamp.
    { word: 'the', accuracy: null, errorType: 'Omission', offsetMs: null, durationMs: null, phonemes: [] },
    // Sounded out slowly, but got there - long duration, decent accuracy.
    { word: 'field', accuracy: 81, errorType: 'None', offsetMs: 4200, durationMs: 1950,
      phonemes: [{ phoneme: 'f', accuracy: 88 }, { phoneme: 'iː', accuracy: 79 }, { phoneme: 'l', accuracy: 80 }, { phoneme: 'd', accuracy: 82 }] },
  ];

  const { signals, diagnostics, insertions } = toWordSignals(words);

  ok(signals.length === 5, 'one WordSignal per expected word (Omission included, nothing dropped)', String(signals.length));
  ok(insertions.length === 0, 'no insertions in a clean-alignment take');

  const rex = signals[0];
  ok(rex.heard === true, 'a normally-read word is heard');
  ok(Math.abs(rex.confidence - 0.92) < 1e-9, 'confidence is Azure word accuracy / 100, not rescaled', String(rex.confidence));
  ok(rex.duration_ms === 280, 'duration_ms passes through unchanged');
  ok(rex.gap_before_ms === 300, 'the FIRST word\'s gap is measured from listening-start (its own offset)', String(rex.gap_before_ms));

  const raced = signals[1];
  ok(raced.confidence < 0.4, 'a genuinely mispronounced word gets low confidence', String(raced.confidence));
  ok(raced.gap_before_ms === 650 - (300 + 280), 'gap_before_ms is offset minus the previous word\'s end', String(raced.gap_before_ms));

  const across = signals[2];
  ok(across.confidence > 0.85, 'confidence tracks the WORD score, not the weak phoneme inside it (k=41)', String(across.confidence));
  ok(across.gap_before_ms > 1200, 'the long hesitation before "across" shows up as a large gap', String(across.gap_before_ms));

  const theWord = signals[3];
  ok(theWord.heard === false, 'an Omission is not heard');
  ok(theWord.confidence === 0, 'and carries zero confidence');
  ok(theWord.duration_ms === 0 && theWord.gap_before_ms === 0, 'no fabricated timing for a word that was never said');

  const field = signals[4];
  ok(field.duration_ms === 1950, 'a slowly sounded-out word keeps its real (long) duration');

  ok(diagnostics.length === 5, 'diagnostics has one entry per signal (not per raw Azure word)');
  ok(diagnostics[2].azureMinPhoneme === 41, 'the weak phoneme IS preserved in diagnostics, just not in confidence', String(diagnostics[2].azureMinPhoneme));
  ok(diagnostics[1].azureAccuracy === 38, 'diagnostics keep the raw Azure word accuracy too');
}
{
  // Insertions: the child re-read a word / said something extra. WordSignal
  // has no slot for "unexpected word" (it is indexed by expected word), so
  // these must be dropped from signals but not silently vanish.
  const words: WordScore[] = [
    { word: 'Rex', accuracy: 90, errorType: 'None', offsetMs: 100, durationMs: 300, phonemes: [] },
    { word: 'Rex', accuracy: 91, errorType: 'Insertion', offsetMs: 420, durationMs: 300, phonemes: [] },
    { word: 'ran', accuracy: 87, errorType: 'None', offsetMs: 800, durationMs: 300, phonemes: [] },
  ];
  const { signals, insertions } = toWordSignals(words);
  ok(signals.length === 2, 'an Insertion does not become a WordSignal', String(signals.length));
  ok(insertions.length === 1 && insertions[0] === 'Rex', 'but it is surfaced separately, not silently discarded');
  ok(signals[1].gap_before_ms === 800 - (100 + 300), 'the running clock skips over the dropped insertion correctly', String(signals[1].gap_before_ms));
}
{
  // Unassessed: Azure recognized something but returned no assessment block
  // at all (toWordScores() in lib/pronunciation.ts). Rare, but must not throw
  // on a null accuracy.
  const words: WordScore[] = [
    { word: 'zoop', accuracy: null, errorType: 'Unassessed', offsetMs: 100, durationMs: 250, phonemes: [] },
  ];
  const { signals } = toWordSignals(words);
  ok(signals[0].heard === true, 'Unassessed still means something was heard');
  ok(signals[0].confidence === 0, 'but with no score to translate, confidence is the documented 0 fallback');
}
{
  // MDD enrichment: diagnostics should pick up the decode score when
  // provided, exactly like combineVerdicts already does - proving phoneme
  // AND decode-layer evidence both survive into diagnostics even though
  // neither touches WordSignal itself.
  const words: WordScore[] = [
    { word: 'cat', accuracy: 70, errorType: 'None', offsetMs: 0, durationMs: 300, phonemes: [{ phoneme: 'k', accuracy: 65 }] },
  ];
  const decode: DecodeResult = {
    recognized: 'cot',
    words: [{ word: 'cat', per: 0.6, score: 40, expected: 'k ae t', heard: 'k a t' }],
    sentence_score: 40,
  };
  const { diagnostics } = toWordSignals(words, decode);
  ok(diagnostics[0].decodeScore === 40, 'MDD decode score reaches diagnostics', String(diagnostics[0].decodeScore));
  ok(diagnostics[0].decodeHeard === 'k a t', 'and what MDD actually decoded is preserved too');
}
{
  // toSentenceResult: the thin SentenceResult wrapper. assisted/reread are
  // caller-supplied (the adapter cannot know how the reading happened).
  const words: WordScore[] = [
    { word: 'Rex', accuracy: 90, errorType: 'None', offsetMs: 0, durationMs: 300, phonemes: [] },
  ];
  const { sentence } = toSentenceResult(0, 'Rex ran.', words, null, { assisted: true });
  ok(sentence.text === 'Rex ran.', 'reference text passes through as SentenceResult.text');
  ok(sentence.assisted === true && sentence.reread === false, 'assisted/reread come from the caller, not inferred');
  ok(sentence.words.length === 1 && sentence.words[0].word === 'Rex', 'words is the adapted WordSignal array');
}

section('Help ladder - config-driven copy, no judgment');
{
  ok(rungLine(1, { word: 'sat', sentence: 'The cat sat.', stage: 1 }) === 'That word begins with /s/.',
     'rung 1 gives a phoneme cue from the stage graphemes, not the word', rungLine(1, { word: 'sat', sentence: 'The cat sat.', stage: 1 }));
  ok(!rungLine(1, { word: 'sat', sentence: 'The cat sat.', stage: 1 }).includes('sat'),
     'rung 1 never reveals the literal word');
  ok(rungLine(2, { word: 'sat', sentence: 'The cat sat.', stage: 1 }) === 'That word is sat. Your turn.',
     'rung 2 reveals the word, verbatim from config.json');
  ok(rungLine(3, { word: 'sat', sentence: 'The cat sat.', stage: 1 }) === 'Let me read this one. The cat sat.',
     'rung 3 reads the whole sentence, verbatim from config.json');
  ok(graphemeCueFor('shadow', 4) === '/sh/', 'a digraph introduced by the given stage is preferred over its single-letter substring', graphemeCueFor('shadow', 4));
  ok(graphemeCueFor('shadow', 4) !== graphemeCueFor('sat', 1),
     'different graphemes produce different cues (not a generic fallback for everything)');
  for (const line of HELP_LADDER.encouragement_lines) {
    ok(!HELP_LADDER.rules.never_say.some((bad) => line.toLowerCase().includes(bad)),
       `encouragement line avoids banned words: "${line}"`);
  }
}

section('Canonical session accumulation - interpretSessionWithIntervention()');
{
  // Clean chapter, no interventions anywhere: identical to plain
  // interpretSession() - the override function must be a no-op when nothing
  // was intervened on.
  const s = session([sentence(six(clean)), sentence(six(clean)), sentence(six(clean))]);
  const r = interpretSessionWithIntervention(s);
  ok(r.accuracy === 1, 'a clean chapter is still 100% through the wrapper');
  ok(r.trickyWords.length === 0 && r.cleanWords.length === 0, 'no tricky/clean words on a clean chapter');
}
{
  // The exact Class A shape from docs/HELP_BOUNDARY_VALIDATION.md: a word
  // whose confidence clears interpret.ts's floor (would read 'correct') but
  // that live's combineVerdicts() already intervened on. previouslyTricky
  // makes it eligible for cleanWords IF interpretSession() judged it
  // 'correct' - the override must remove that eligibility.
  const raced: WordSignal = { word: 'raced', confidence: 0.38, duration_ms: 410, gap_before_ms: 100, heard: true };
  const s = session([sentence([...six(clean).slice(0, 5), raced])]);
  const interventions: SessionIntervention = [[false, false, false, false, false, true]];

  const withoutOverride = interpretSessionWithIntervention(s, [[false, false, false, false, false, false]]);
  const racedOutcomeNoOverride = withoutOverride.words.find((w) => w.word === 'raced')!;
  ok(racedOutcomeNoOverride.verdict === 'correct', 'sanity: without intervention, 0.38 clears the floor and reads correct');

  const withOverride = interpretSessionWithIntervention(s, interventions, undefined, ['raced']);
  const racedOutcome = withOverride.words.find((w) => w.word === 'raced')!;
  ok(racedOutcome.verdict === 'stumbled', 'live intervention overrides a would-be correct verdict to stumbled', racedOutcome.verdict);
  ok(!withOverride.cleanWords.includes('raced'), 'and it can never land in cleanWords, even though it was previously tricky');
  ok(racedOutcome.reason.includes('live intervention'), 'the outcome reason says WHY, for debugging', racedOutcome.reason);
}
{
  // Intervention must never touch a verdict interpret.ts already flagged on
  // its own (stumbled/missed) - only a would-be 'correct' can be overridden.
  // This also covers "silence follows the ladder": an all-Omission (missed)
  // word that live also flagged (intervention: true) stays 'missed', not
  // reclassified into something else.
  const s = session([sentence([...six(clean).slice(0, 4), mumbled('big'), silent('dog')])]);
  const interventions: SessionIntervention = [[false, false, false, false, true, true]];
  const r = interpretSessionWithIntervention(s, interventions);
  ok(r.words.find((w) => w.word === 'big')!.verdict === 'stumbled', 'an already-stumbled word stays stumbled under intervention');
  ok(r.words.find((w) => w.word === 'dog')!.verdict === 'missed', 'an already-missed (silent) word stays missed under intervention');
}
{
  // Assisted/reread sentences are excluded outright by interpret.ts, before
  // the override ever runs - intervention on an assisted sentence's words
  // must have zero effect, since none of them can ever be 'correct'.
  const s = session([
    sentence(six(clean), { assisted: true }),
    sentence(six(clean), { reread: true }),
    sentence(six(clean)), sentence(six(clean)), sentence(six(clean)),
  ]);
  const allTrue: SessionIntervention = s.sentences.map((sen) => sen.words.map(() => true));
  const r = interpretSessionWithIntervention(s, allTrue);
  ok(r.words.filter((w) => w.excludedBecause === 'assisted').length === 6, 'assisted words stay excluded regardless of intervention');
  ok(r.words.filter((w) => w.excludedBecause === 'reread').length === 6, 'reread words stay excluded regardless of intervention');
  ok(r.countedWords === 18, 'only the three real sentences count, same as plain interpretSession()');
}
{
  // A full chapter: one clean page, one page that reached rung 3
  // (assisted), one page the child heard replayed first (reread) - the
  // shape a real /read session actually accumulates, run through the ONE
  // canonical entry point end to end.
  const raced: WordSignal = { word: 'raced', confidence: 0.4, duration_ms: 400, gap_before_ms: 100, heard: true };
  const s: SessionInput = {
    childId: 'c1', sessionId: 'chapter-e2e', stage: 2, chapterId: 'the-shiny-thing',
    isBookshelfReread: false, startedAt: new Date().toISOString(),
    sentences: [
      { index: 0, text: 'Rex raced across the field.', words: [clean('Rex'), raced, ...six(clean).slice(0, 4)], assisted: false, reread: false },
      { index: 1, text: 'It was a little gold key.', words: six(clean), assisted: true, reread: false },
      { index: 2, text: 'Rex looked and looked.', words: six(clean), assisted: false, reread: true },
    ],
  };
  const interventions: SessionIntervention = [
    [false, true, false, false, false, false],
    [false, false, false, false, false, false],
    [false, false, false, false, false, false],
  ];
  const r = interpretSessionWithIntervention(s, interventions, undefined, ['raced']);
  ok(r.sessionId === 'chapter-e2e', 'the SessionInput round-trips its identity');
  ok(s.sentences.length === 3, 'the accumulated session has one SentenceResult per page');
  ok(s.sentences.filter((sen) => sen.assisted).length === 1, 'exactly the rung-3 page is marked assisted');
  ok(r.words.find((w) => w.word === 'raced')!.verdict === 'stumbled', 'the Class A word is caught even inside a full multi-page chapter');
  ok(!r.cleanWords.includes('raced'), 'and stays out of cleanWords at chapter scope, not just in isolation');
  ok(r.excludedWords === 12, 'both the assisted page and the reread page are excluded (2 pages x 6 words)', String(r.excludedWords));
  ok(typeof r.excludedFromProgression === 'boolean', 'excludedFromProgression is a plain boolean, never a score');
}

section('Slot filling - nouns chosen by code, never by the model');
{
  ok(slotOptions('creature', 1).length === 0, 'stage 1 has no animal nouns at all');
  ok(slotOptions('object', 1).length > 0, 'but it does have objects');
  ok(slotOptions('creature', 3).length > 0, 'animals arrive by stage 3');
  ok(slotOptions('object', 10).length > slotOptions('object', 1).length,
     'vocabulary grows with the stage');
}
{
  // A skeleton needing an animal must not be offered at stage 1, even though
  // nothing about its beats says "stage 3".
  const needsCreature = SKELETONS.find((s) => slotsFor(s).includes('creature'))!;
  ok(!canRunAtStage(needsCreature.beats, 1),
     'a skeleton needing an animal cannot run at stage 1');
  ok(canRunAtStage(needsCreature.beats, 4), 'but can once animals exist');
  ok(!skeletonsForStage(1).some((s) => slotsFor(s).includes('creature')),
     'and is not offered at stage 1');
}
{
  const sk = SKELETONS[0];
  const a = assignSlots(sk.beats, 5, { random: () => 0 });
  const rendered = renderBeats(sk.beats, a, { childName: 'Sam', petName: 'Pip' });
  ok(unresolvedSlots(rendered).length === 0, 'every blank gets filled');
  ok(rendered.every((r) => !r.includes('{')), 'no template tokens survive');
  ok(rendered.some((r) => r.includes('Sam')), 'the child is named');
  ok(rendered.some((r) => r.includes('Pip')), 'the pet is named');
}
{
  // The point of the whole rebuild: chosen nouns are always in the palette.
  for (const stage of [1, 3, 5, 8, 10]) {
    const allowed = allowedWordsForStage(stage);
    let bad: string[] = [];
    for (const sk of skeletonsForStage(stage)) {
      for (let i = 0; i < 40; i++) {
        const a = assignSlots(sk.beats, stage, { random: Math.random });
        for (const w of Object.values(a)) if (!allowed.has(w!)) bad.push(`${w}@${stage}`);
      }
    }
    ok(bad.length === 0, `stage ${stage}: every chosen noun is decodable`, bad.slice(0, 5).join(','));
  }
}
{
  const blocked = new Set([...CONTENT_BLOCKLIST, ...HUMAN_NOUNS]);
  let bad: string[] = [];
  for (const stage of [1, 3, 5, 8, 10]) {
    for (const sk of skeletonsForStage(stage)) {
      for (let i = 0; i < 40; i++) {
        for (const w of Object.values(assignSlots(sk.beats, stage, { random: Math.random }))) {
          if (blocked.has(w!)) bad.push(w!);
        }
      }
    }
  }
  ok(bad.length === 0, 'no chosen noun is ever blocklisted or a human', bad.slice(0, 5).join(','));
}
{
  // portable and fixture partition object, and portable never leaks a bed.
  const portable = new Set(slotOptions('portable', 10));
  const fixture = new Set(slotOptions('fixture', 10));
  const object = new Set(slotOptions('object', 10));
  ok([...portable].every((w) => object.has(w)), 'portable is a subset of object');
  ok([...fixture].every((w) => object.has(w)), 'fixture is a subset of object');
  ok([...portable].every((w) => !fixture.has(w)), 'nothing is both portable and fixed');
  ok(object.size === portable.size + fixture.size, 'together they cover object exactly');
  for (const w of ['bed', 'table', 'car', 'tree', 'window']) {
    ok(fixture.has(w) && !portable.has(w), `'${w}' is a fixture, not portable`);
  }
  for (const w of ['tin', 'box', 'book', 'apple']) {
    ok(portable.has(w), `'${w}' is portable`);
  }
}
{
  // The bug this split was for: the object that goes missing must be carryable.
  const sk = SKELETONS.find((s) => s.id === 'the-thing-that-will-not-stay-put')!;
  ok(slotsFor(sk).includes('portable'), 'the missing-object skeleton asks for a portable');
  const portable = new Set(slotOptions('portable', 10));
  let bad: string[] = [];
  for (let i = 0; i < 100; i++) {
    const a = assignSlots(sk.beats, 10, { random: Math.random });
    if (!portable.has(a.portable!)) bad.push(a.portable!);
  }
  ok(bad.length === 0, 'and never picks something a child could not carry', bad.slice(0, 3).join(','));
}
{
  const sk = SKELETONS.find((s) => slotsFor(s).includes('portable'))!;
  const all = slotOptions('portable', 10);
  const avoid = all.slice(0, all.length - 1);
  const a = assignSlots(sk.beats, 10, { avoid, random: () => 0 });
  ok(a.portable === all[all.length - 1], 'recently used nouns are avoided when possible');

  const a2 = assignSlots(sk.beats, 1, { avoid: slotOptions('portable', 1), random: () => 0 });
  ok(a2.portable !== undefined, 'but avoidance never causes a failure when choice runs out');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
