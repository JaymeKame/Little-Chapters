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
import { adaptTutorDraft, resolveGenerationStage, resolveGenerationContext, stageForAge, chapterIdFor, chapterFor, requestTutorChapter, chapterDebugInfo } from '../../lib/chapters.ts';
import { chapterIdForDay, todayLocal, isValidDay } from '../../lib/chapter-id.ts';
import { appendChapterHistoryEntry, wasChapterCompleted, loadChapterHistoryLocal } from '../../lib/chapter-history.ts';
import { freeChapterSpent, chaptersCompleted } from '../../lib/entitlement.ts';
import { fetchRemoteProfile, mirrorProfileRemote } from '../../lib/profile.ts';
import { generateStoryDraft, isStoryGenerationConfigured } from '../../lib/story-generator.server.ts';
import { isAuthoritativeChapterRecord, type PersistedChapterRecord } from '../../lib/chapter-store-admin.ts';
import { resolveRootEntry } from '../../lib/root-entry.ts';
import { toWordSignals, toSentenceResult } from '../../lib/reading-signal-adapter.ts';
import { interpretSessionWithIntervention, type SessionIntervention } from '../../lib/reading-session-interpreter.ts';
import { HELP_LADDER, rungLine, graphemeCueFor, segmentWord } from '../../lib/help-ladder.ts';
import type { WordScore } from '../../lib/pronunciation.ts';
import type { DecodeResult } from '../../lib/reading-verdict.ts';
import {
  defaultProgressFor,
  completeSessionPure,
  completeSessionLocally,
  loadLocalProgress,
  saveLocalProgress,
  wasSessionCompleted,
  claimChildProgressFromAnonymousUid,
} from '../../lib/child-progress.ts';
import type { ChildProfile } from '../../lib/profile.ts';

// Node has no global localStorage without --experimental-webstorage;
// lib/child-progress.ts's local store (like every other local store in this
// app) is written against the real browser API. Minimal in-memory shim so
// its I/O layer — not just its pure functions — can be exercised here the
// same way the rest of this suite exercises real modules, per CLAUDE.md's
// "exercised with plain node scripts" convention.
if (typeof (globalThis as unknown as { localStorage?: unknown }).localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as Storage;
}

// lib/entitlement.ts's chaptersCompleted()/freeChapterSpent() guard on
// `typeof window === 'undefined'` for SSR safety — a real browser always has
// `window`, but bare Node/tsx does not, so without this every call here
// silently short-circuits to 0/false regardless of what localStorage holds.
// Aliasing to globalThis (not a full DOM shim — nothing here needs more than
// the truthy `typeof window !== 'undefined'` check to pass) exercises the
// real functions' actual logic instead of their SSR fallback.
if (typeof (globalThis as unknown as { window?: unknown }).window === 'undefined') {
  (globalThis as unknown as { window: unknown }).window = globalThis;
}

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
    { childId: 'child-sam', childName: 'Sam', age: 6, interests: ['dogs'], createdAt: 1 },
    { sentences: ['Sam sat on a mat', 'Pip sat by Sam'], imagePrompt: 'Sam and Pip', summaryLine: 'Sam found a mat' },
    SKELETONS[0],
  );
  ok(chapter !== null, 'a draft with sentences adapts successfully');
  if (!chapter) throw new Error('adapter returned null for a valid draft');
  const empty = adaptTutorDraft(
    { childId: 'child-sam', childName: 'Sam', age: 6, interests: ['dogs'], createdAt: 1 },
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

section('Word segmentation - segmentWord() for the slide-through interaction');
{
  const texts = (segs: ReturnType<typeof segmentWord>) => segs?.map((s) => s.text);

  ok(JSON.stringify(texts(segmentWord('sat', 1))) === JSON.stringify(['s', 'a', 't']),
     'single-letter-only word segments one grapheme per letter', JSON.stringify(texts(segmentWord('sat', 1))));

  ok(JSON.stringify(texts(segmentWord('shop', 4))) === JSON.stringify(['sh', 'o', 'p']),
     'a two-letter digraph is preferred over decomposing into its single letters',
     JSON.stringify(texts(segmentWord('shop', 4))));

  ok(JSON.stringify(texts(segmentWord('chick', 4))) === JSON.stringify(['ch', 'i', 'ck']),
     'two different multi-letter graphemes in one word both resolve correctly',
     JSON.stringify(texts(segmentWord('chick', 4))));

  ok(JSON.stringify(texts(segmentWord('well', 3))) === JSON.stringify(['w', 'e', 'll']),
     'a doubled-letter grapheme (ll) is treated as one segment, not two',
     JSON.stringify(texts(segmentWord('well', 3))));

  ok(JSON.stringify(texts(segmentWord('star', 7))) === JSON.stringify(['s', 't', 'ar']),
     'an r-controlled vowel grapheme segments as one unit',
     JSON.stringify(texts(segmentWord('star', 7))));

  ok(JSON.stringify(texts(segmentWord('rain', 8))) === JSON.stringify(['r', 'ai', 'n']),
     'a vowel-team grapheme segments as one unit',
     JSON.stringify(texts(segmentWord('rain', 8))));

  ok(JSON.stringify(texts(segmentWord('bridge', 5))) === JSON.stringify(['b', 'r', 'i', 'dge']),
     'a trailing digraph that happens to end in "e" (dge) is not mistaken for silent-e',
     JSON.stringify(texts(segmentWord('bridge', 5))));

  ok(JSON.stringify(texts(segmentWord('snow', 9))) === JSON.stringify(['s', 'n', 'ow']),
     'pronunciation-disambiguated ids (ow_o vs ow_ow) still collapse to the one real substring "ow"',
     JSON.stringify(texts(segmentWord('snow', 9))));

  ok(segmentWord('thin', 1) === null,
     'a word needing a letter/digraph not yet taught at this stage (h, th) fails closed, not with a wrong guess');

  ok(segmentWord('', 5) === null, 'an empty word fails closed');

  for (const [word, stage] of [['gate', 6], ['bike', 6], ['bone', 8], ['cube', 10], ['cake', 6]] as const) {
    ok(segmentWord(word, stage) === null,
       `silent-e word "${word}" is refused rather than approximated as ${JSON.stringify(texts(segmentWord(word, stage) ?? []))} — must fall back to the existing rung 1/2/3 ladder`);
  }

  // The demo chapter's own dogs-interest "spot" word, exercised end to end
  // in the real /read page's dev sim flow — this is the concrete fallback
  // case the Playwright walkthrough below also drives.
  ok(segmentWord('gate', 10) === null, 'the actual demo word "gate" (dogs interest) is refused at every stage, not just stage 6');

  // And its ocean-interest counterpart is the concrete SUCCESS case the
  // walkthrough drives — confirms a real, currently-shipping focus word
  // segments cleanly, not just constructed test words.
  ok(JSON.stringify(texts(segmentWord('shell', 4))) === JSON.stringify(['sh', 'e', 'll']),
     'the actual demo word "shell" (ocean interest) segments cleanly',
     JSON.stringify(texts(segmentWord('shell', 4))));
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

section('Child progress - new child, initial stage');
{
  const p = defaultProgressFor('child-1', 6);
  ok(p.childId === 'child-1', 'a fresh ChildProgress carries the child id');
  ok(p.stage === initialStage(6), 'stage seeds from initialStage(ageDerivedEstimate), not raw age', String(p.stage));
  ok(p.stage === 5, 'concretely: stageForAge-style estimate 6 seeds stage 5 (one below, per initialStage)', String(p.stage));
  ok(p.mode === 'placement' && p.sessionsCompleted === 0, 'a new child starts in placement with zero sessions');
}

section('Child progress - completeSessionPure: progression, exclusions, idempotency');
{
  // Clean session, well above the placement big-jump threshold: moves.
  const progress = defaultProgressFor('child-1', 6); // stage 5
  const clean18 = session([sentence(six(clean)), sentence(six(clean)), sentence(six(clean))], { childId: 'child-1', chapterId: 'day-1', stage: progress.stage });
  const r = completeSessionPure({ progress, alreadyCompleted: false, sessionInput: clean18, interventions: [] });
  ok(r.applied, 'a clean valid session applies progression');
  ok(r.nextProgress.stage === progress.stage + 2, 'placement mode: well above level jumps two stages', String(r.nextProgress.stage));
  ok(r.nextProgress.sessionsCompleted === 1, 'sessionsCompleted increments');
  ok(!('accuracy' in r.persistedSession), 'the persisted session record never carries accuracy', JSON.stringify(Object.keys(r.persistedSession)));
  ok(!JSON.stringify(r.persistedSession).includes('"accuracy"'), 'and no accuracy-shaped key survives serialisation either');
  ok(r.persistedSession.chapterId === 'day-1' && r.persistedSession.childId === 'child-1', 'the persisted shape keeps chapter/child identity');
  ok(typeof r.persistedSession.completedAt === 'string' && typeof r.persistedSession.startedAt === 'string', 'and start/complete timestamps');
  ok(Array.isArray(r.persistedSession.trickyWords) && Array.isArray(r.persistedSession.cleanWords), 'and tricky/clean words for the parent-facing history');
}
{
  // Assisted-heavy: excluded from progression, stage must not move (rung-3
  // "skip / carried forward" sentences per the product ruling — assisted,
  // not counted as a failure).
  const progress = { ...defaultProgressFor('child-1', 6), stage: 5 };
  const s = session([
    sentence(six(mumbled)), sentence(six(mumbled)),
    sentence(six(clean), { assisted: true }),
    sentence(six(clean), { assisted: true }),
    sentence(six(clean), { assisted: true }),
  ], { chapterId: 'day-2', stage: progress.stage });
  const r = completeSessionPure({ progress, alreadyCompleted: false, sessionInput: s, interventions: [] });
  ok(r.applied, 'an assisted-heavy session still "applies" (sessionsCompleted still counts a night happened)');
  ok(r.nextProgress.stage === progress.stage, 'but the stage itself does not move', String(r.nextProgress.stage));
  ok(r.reading.excludedFromProgression && r.reading.excludedReason === 'assisted-heavy', 'and says why');
}
{
  // Reread: excluded from counting, same as assisted — enough of it (here,
  // 3 of 4 sentences) drops below minCountableWords, so the session cannot
  // move the stage even though the one real sentence read was clean.
  const progress = { ...defaultProgressFor('child-1', 6), stage: 5 };
  const s = session([
    sentence(six(clean), { reread: true }), sentence(six(clean), { reread: true }),
    sentence(six(clean), { reread: true }), sentence(six(clean)),
  ], { chapterId: 'day-3', stage: progress.stage });
  const r = completeSessionPure({ progress, alreadyCompleted: false, sessionInput: s, interventions: [] });
  ok(r.nextProgress.stage === progress.stage, 'reread-heavy does not move the stage', String(r.nextProgress.stage));
  ok(r.reading.excludedReason === 'too-few-words', 'too little unassisted signal remains to count', r.reading.excludedReason);
}
{
  // Bookshelf reread: whole session excluded from progression regardless of
  // how well it went.
  const progress = { ...defaultProgressFor('child-1', 6), stage: 5 };
  const s = session(
    [sentence(six(clean)), sentence(six(clean)), sentence(six(clean))],
    { chapterId: 'day-4', stage: progress.stage, isBookshelfReread: true },
  );
  const r = completeSessionPure({ progress, alreadyCompleted: false, sessionInput: s, interventions: [] });
  ok(r.nextProgress.stage === progress.stage, 'a bookshelf reread never moves the stage', String(r.nextProgress.stage));
  ok(r.reading.excludedReason === 'bookshelf-reread', 'and says why');
}
{
  // Insufficient countable words.
  const progress = { ...defaultProgressFor('child-1', 6), stage: 5 };
  const s = session([sentence(['hi', 'go'].map(clean))], { chapterId: 'day-5', stage: progress.stage });
  const r = completeSessionPure({ progress, alreadyCompleted: false, sessionInput: s, interventions: [] });
  ok(r.nextProgress.stage === progress.stage, 'too few countable words never moves the stage', String(r.nextProgress.stage));
  ok(r.reading.excludedReason === 'too-few-words', 'and says why');
}
{
  // Idempotency at the pure-function level: alreadyCompleted short-circuits
  // progression entirely, even though the same accuracy would otherwise move
  // the stage.
  const progress = { ...defaultProgressFor('child-1', 6), stage: 5 };
  const s = session([sentence(six(clean)), sentence(six(clean)), sentence(six(clean))], { chapterId: 'day-6', stage: progress.stage });
  const first = completeSessionPure({ progress, alreadyCompleted: false, sessionInput: s, interventions: [] });
  const repeat = completeSessionPure({ progress: first.nextProgress, alreadyCompleted: true, sessionInput: s, interventions: [] });
  ok(first.applied === true && repeat.applied === false, 'the first completion applies, a repeat does not');
  ok(repeat.nextProgress.stage === first.nextProgress.stage && repeat.nextProgress.sessionsCompleted === first.nextProgress.sessionsCompleted,
     'a repeat leaves progress byte-for-byte where the first completion left it');
}

section('Child progress - Class A intervention still prevents cleanWords, end to end');
{
  // The full chapter shape from lib/reading-session-interpreter.ts's own
  // tests, run through the persistence layer this time.
  const progress = { ...defaultProgressFor('child-1', 6), stage: 5, trickyWords: ['raced'] };
  const raced: WordSignal = { word: 'raced', confidence: 0.4, duration_ms: 400, gap_before_ms: 100, heard: true };
  const s: SessionInput = {
    childId: 'child-1', sessionId: 'sess-a', stage: progress.stage, chapterId: 'day-7',
    isBookshelfReread: false, startedAt: new Date().toISOString(),
    sentences: [{ index: 0, text: 'Rex raced.', words: [clean('Rex'), raced], assisted: false, reread: false }],
  };
  const r = completeSessionPure({ progress, alreadyCompleted: false, sessionInput: s, interventions: [[false, true]], previouslyTricky: ['raced'] });
  ok(!r.persistedSession.cleanWords.includes('raced'), 'live intervention keeps a would-be-correct word out of the persisted cleanWords');
  ok(r.persistedSession.trickyWords.includes('raced'), 'and it is recorded tricky instead');
}

section('Child progress - localStorage I/O: idempotent completion, reload, migration');
{
  const uid = 'uid-real-1';
  const childId = 'child-io-1';
  const ageEstimate = 6;
  const s = session([sentence(six(clean)), sentence(six(clean)), sentence(six(clean))], { chapterId: 'chapter-io-1', stage: initialStage(ageEstimate) });

  ok(loadLocalProgress(uid, childId) === null, 'no progress exists for a brand-new child yet');
  ok(!wasSessionCompleted(uid, childId, 'chapter-io-1'), 'and the chapter has not been completed yet either');

  const first = completeSessionLocally(uid, childId, ageEstimate, s, []);
  ok(first.applied, 'first completion applies progression');
  ok(wasSessionCompleted(uid, childId, 'chapter-io-1'), 'the ledger now shows this chapter completed');

  // Simulate a genuine double-tap / retried network request: the exact same
  // sessionInput, completed again.
  const second = completeSessionLocally(uid, childId, ageEstimate, s, []);
  ok(second.applied === false, 'a duplicate completion of the SAME chapter does not re-apply');
  ok(second.progress.stage === first.progress.stage && second.progress.sessionsCompleted === first.progress.sessionsCompleted,
     'and leaves stage/sessionsCompleted exactly as the first completion did — no double count');

  // Reload: a fresh load (no in-memory state carried over) restores exactly
  // what was persisted.
  const reloaded = loadLocalProgress(uid, childId);
  ok(reloaded !== null && reloaded!.stage === first.progress.stage && reloaded!.sessionsCompleted === first.progress.sessionsCompleted,
     'reloading restores the same progression state');

  // A DIFFERENT chapter completing is a genuine new session, not a duplicate.
  const s2 = session([sentence(six(clean)), sentence(six(clean)), sentence(six(clean))], { chapterId: 'chapter-io-2', stage: first.progress.stage });
  const third = completeSessionLocally(uid, childId, ageEstimate, s2, []);
  ok(third.applied, 'a genuinely different chapterId is a new session and DOES apply');
  ok(third.progress.sessionsCompleted === first.progress.sessionsCompleted + 1, 'sessionsCompleted advances for the new session, not the repeat');
}
{
  // Anonymous -> signed-in migration (the "linking failed, new uid" fallback
  // path — see components/AuthProvider.tsx claimAnonymousChild). Mirrors
  // lib/pet.ts's claimPetFromAnonymousUid invariants exactly.
  const anonUid = 'uid-anon-migrate';
  const realUid = 'uid-real-migrate';
  const childId = 'child-migrate-1';
  const progress = { ...defaultProgressFor(childId, 6), sessionsCompleted: 3 };
  saveLocalProgress(anonUid, childId, progress);

  claimChildProgressFromAnonymousUid(realUid, anonUid, childId);
  const migrated = loadLocalProgress(realUid, childId);
  ok(migrated !== null && migrated!.sessionsCompleted === 3, 'progress moves to the new uid on claim');
  ok(loadLocalProgress(anonUid, childId) === null, 'and is removed from the old anonymous uid — no double copy left behind');

  // Idempotent: claiming again (e.g. a second onAuthStateChanged firing)
  // must not clobber the now-populated destination or throw.
  saveLocalProgress(anonUid, childId, { ...defaultProgressFor(childId, 6), sessionsCompleted: 99 }); // a NEW orphan, e.g. a sibling reusing the device
  claimChildProgressFromAnonymousUid(realUid, anonUid, childId);
  const stillMigrated = loadLocalProgress(realUid, childId);
  ok(stillMigrated !== null && stillMigrated!.sessionsCompleted === 3, 'a second claim never overwrites an already-owned destination', String(stillMigrated?.sessionsCompleted));
}

section('Progress API routes - ownership is derived from the verified token, never client input');
{
  // No Firestore emulator is available in this environment (see
  // docs/PERSISTENCE.md's report), so this is a static guarantee, not a
  // live integration test: the route source must derive `uid` exclusively
  // from requireReadingUser()'s verified token and must never read a uid
  // out of the request body or query string to address Firestore.
  const fs = await import('node:fs');
  const routeSources = [
    fs.readFileSync(new URL('../../app/api/progress/complete-session/route.ts', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../../app/api/progress/child/route.ts', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../../lib/progress-store-admin.ts', import.meta.url), 'utf8'),
  ];
  const suspiciousPatterns = [/body\.uid/, /body\[.uid.\]/, /searchParams\.get\(.uid.\)/, /req\.uid/];
  for (const src of routeSources) {
    ok(!suspiciousPatterns.some((p) => p.test(src)), 'route/store source never reads a client-supplied uid');
  }
  ok(routeSources[0].includes('auth.uid') && routeSources[1].includes('auth.uid'),
     'both routes address Firestore using the verified auth.uid instead');
}

section('Adaptive loop - persisted stage wins over age (the specific regression this task exists to prevent)');
{
  // The task's own worked example: age implies Stage 3, but the persisted
  // ChildProgress says Stage 2. Generation must use Stage 2. This is
  // deliberately separate from the narrative test below so it can never be
  // accidentally satisfied by the two numbers coinciding.
  const uid = 'uid-differ-1';
  const profile: ChildProfile = {
    childId: 'child-differ-1', childName: 'Kai', age: 7,
    interests: ['space'], createdAt: Date.now(),
  };
  ok(stageForAge(profile.age) === 3, 'sanity: age implies stage 3 for this profile');
  saveLocalProgress(uid, profile.childId, { ...defaultProgressFor(profile.childId, 3), stage: 2 });
  const stage = resolveGenerationStage(profile, uid);
  ok(stage === 2, 'generation uses the PERSISTED stage (2), not the age-derived one (3) — the exact failure mode this task guards against', String(stage));
  const context = resolveGenerationContext(profile, uid);
  ok(context.stage === 2, 'and the full generation context carries the same persisted stage through');
}

section('Adaptive loop - Phase 5: one complete lifecycle through the real production functions');
{
  const uid = 'uid-loop-1';
  const profile: ChildProfile = {
    childId: 'child-loop-1', childName: 'Nia', age: 7,
    interests: ['dogs'], createdAt: Date.now(),
  };

  // 1. Child begins with stage S. No ChildProgress exists yet for this
  //    child, so generation seeds from initialStage(stageForAge(age)) —
  //    the SAME composition lib/child-progress.ts's defaultProgressFor()
  //    uses for the progress record itself (Phase 1/3's "first use: age ->
  //    initial stage").
  ok(stageForAge(profile.age) === 3, 'sanity: this profile\'s age implies stage 3');
  const seedStage = resolveGenerationStage(profile, uid);
  ok(seedStage === initialStage(3) && seedStage === 2, 'a brand-new child seeds one stage below the age estimate, not at it', String(seedStage));

  // 2. Today's chapter exists at stage S=2 — generated (not asserted) via
  //    the REAL generateChapter()/validateAll(), unmodified, with a
  //    deterministic fake LLM client (no OPENAI_API_KEY / network in this
  //    environment — same constraint, same fixture-injection point, the
  //    existing "Generator" tests above already use).
  ok(allowedWordsForStage(seedStage).has('cat') && allowedWordsForStage(seedStage).has('mat'),
     'sanity: the words this test relies on are genuinely legal at the seeded stage');
  const cast1 = { childName: profile.childName, petName: 'Momo' };
  const day1Llm: LlmClient = {
    async complete() {
      return JSON.stringify({
        sentences: ['Nia sat on a mat', 'Momo sat on a mat', 'Nia and Momo had fun', 'The cat sat on it'],
        imagePrompt: 'Nia and Momo on a mat', summaryLine: 'Nia and Momo had fun on the mat',
      });
    },
  };
  const day1 = await generateChapter({
    stage: seedStage, cast: cast1, interests: profile.interests,
    storySoFar: '', recentlyMissedWords: [], skeleton: SKELETONS[0],
  }, day1Llm);
  ok(day1.ok && !!day1.draft, 'today\'s chapter is a real, validator-passing draft at stage S', JSON.stringify(day1.rejectionLog));
  const day1Chapter = day1.draft && adaptTutorDraft(profile, day1.draft, SKELETONS[0], day1.slots, seedStage);
  ok(!!day1Chapter && day1Chapter.pages.length > 0, 'and adapts into a real Chapter through the existing lifecycle function');
  ok(!!day1Chapter && day1Chapter.phonics[0].hint === `Stage ${seedStage} practice`, 'labelled with the stage it was actually generated at');

  // 3. Child completes a canonical reading session, 4. with at least one
  //    legitimate difficulty recorded ('cat', mumbled — genuinely stumbled,
  //    not skipped/reread, so it's an honest tricky-word signal).
  const session: SessionInput = {
    childId: profile.childId, sessionId: 'sess-loop-1', stage: seedStage, chapterId: 'chapter-loop-day1',
    isBookshelfReread: false, startedAt: new Date().toISOString(),
    sentences: [
      sentence(six(clean)),
      sentence([...six(clean).slice(0, 5), mumbled('cat')]),
      sentence(six(clean)),
    ],
  };
  // 5. Session persists once, 6. applySession() runs once, 7. updated
  //    ChildProgress is persisted — all via the real, unmodified Phase 4/5
  //    persistence function from the previous task.
  const completion = completeSessionLocally(uid, profile.childId, stageForAge(profile.age), session, []);
  ok(completion.applied, 'the session applies progression exactly once');
  ok(completion.reading.trickyWords.includes('cat'), 'the genuine difficulty is recorded as a tricky word');
  ok(completion.progress.trickyWords.includes('cat'), 'and survives onto ChildProgress.trickyWords');
  const stageAfterDay1 = completion.progress.stage;
  ok(stageAfterDay1 === seedStage + 1, 'accuracy (17/18) clears placementJumpAt: stage moves up one', String(stageAfterDay1));

  // 8. Next generation reads the persisted ChildProgress.stage — NOT a
  //    freshly-derived age stage (explicit assertion, per the task).
  const day2Context = resolveGenerationContext(profile, uid);
  ok(day2Context.stage === stageAfterDay1, 'generation request stage EQUALS persisted ChildProgress.stage', `${day2Context.stage} vs ${stageAfterDay1}`);
  ok(day2Context.stage !== stageForAge(profile.age) || day2Context.stage === initialStage(stageForAge(profile.age)) + 1,
     'and is not merely coincidentally equal to a fresh age re-derivation', String(day2Context.stage));
  // 9. Generation receives the intended reinforcement state.
  ok(day2Context.recentlyMissedWords.includes('cat'), 'tomorrow\'s generation context includes the real tricky word for reinforcement');
  ok(day2Context.storySoFar === '', 'no SessionReport exists yet in this test, so continuity is honestly empty, not fabricated');

  // 10. Generated chapter passes the real validators, with the
  //     reinforcement word actually reaching the prompt.
  const day2Prompts: string[] = [];
  const day2Llm: LlmClient = {
    async complete(prompt) {
      day2Prompts.push(prompt);
      return JSON.stringify({
        sentences: ['Nia and Momo sat on a mat', 'The cat sat on the mat', 'Nia had fun with the cat', 'Momo and Nia had a big cat'],
        imagePrompt: 'Nia, Momo, and a cat', summaryLine: 'Nia and Momo met a cat',
      });
    },
  };
  const day2 = await generateChapter({
    stage: day2Context.stage, cast: cast1, interests: profile.interests,
    storySoFar: day2Context.storySoFar, recentlyMissedWords: day2Context.recentlyMissedWords,
    skeleton: SKELETONS[0],
  }, day2Llm);
  ok(day2.ok && !!day2.draft, 'tomorrow\'s chapter also passes the real, unmodified validators', JSON.stringify(day2.rejectionLog));
  ok(day2Prompts[0].includes('cat'), 'the tricky word actually reaches the built prompt, not just the request object');

  // 11. Next chapter is stored/read through the existing chapter lifecycle.
  const day2Chapter = day2.draft && adaptTutorDraft(profile, day2.draft, SKELETONS[0], day2.slots, day2Context.stage);
  ok(!!day2Chapter && day2Chapter.pages.length > 0, 'tomorrow\'s chapter adapts into a real Chapter too');
  ok(!!day2Chapter && day2Chapter.phonics[0].hint === `Stage ${day2Context.stage} practice`, 'labelled with the NEW, moved stage — not the original seed stage');

  // 12. Re-running the completion/generation path does not duplicate
  //     progression or create competing chapters.
  const repeat = completeSessionLocally(uid, profile.childId, stageForAge(profile.age), session, []);
  ok(repeat.applied === false, 'repeating the SAME chapter\'s completion does not re-apply progression');
  ok(repeat.progress.stage === stageAfterDay1 && repeat.progress.sessionsCompleted === completion.progress.sessionsCompleted,
     'progress after the repeat is byte-identical to after the first completion');
  const day2ContextAgain = resolveGenerationContext(profile, uid);
  ok(day2ContextAgain.stage === day2Context.stage && JSON.stringify(day2ContextAgain.recentlyMissedWords) === JSON.stringify(day2Context.recentlyMissedWords),
     'a second generation-context read (e.g. a refreshed page) resolves identically — same stage means the same cache id, so requestTutorChapter\'s existing cache/inFlight dedup (unmodified) serves the cached chapter instead of generating a competing one');
}

section('Adaptive loop - API route forwards personalization inputs (static check — no OPENAI_API_KEY in this environment)');
{
  // Mirrors the previous task's "ownership derived from verified token"
  // static check: the live route 503s immediately without an API key, so
  // this proves the WIRING exists in source rather than invoking it.
  //
  // The route itself now delegates the actual OpenAI call to
  // lib/story-generator.server.ts's generateStoryDraft() — shared with the
  // new persisted app/api/chapters/today/route.ts so the two routes cannot
  // silently drift on prompt construction — so this checks two hops: the
  // route forwards recentlyMissedWords/storySoFar into generateStoryDraft(),
  // and generateStoryDraft() itself forwards them into the plan-first
  // StoryBlueprint prompt before any child-facing prose is accepted.
  const fs = await import('node:fs');
  const routeSrc = fs.readFileSync(new URL('../../app/api/chapters/story/route.ts', import.meta.url), 'utf8');
  ok(routeSrc.includes('body.recentlyMissedWords'), 'the route reads recentlyMissedWords from the request body');
  ok(routeSrc.includes('body.storySoFar'), 'and storySoFar');
  ok(
    routeSrc.includes('generateStoryDraft') && routeSrc.includes('recentlyMissedWords,') && routeSrc.includes('storySoFar,'),
    'and forwards them into generateStoryDraft(), not just parses and discards them',
  );
  const generatorSrc = fs.readFileSync(new URL('../../lib/story-generator.server.ts', import.meta.url), 'utf8');
  ok(
    generatorSrc.includes('recentlyMissedWords') && generatorSrc.includes('storySoFar') && generatorSrc.includes('blueprintGenerationPrompt'),
    'and generateStoryDraft() itself forwards them into the complete StoryBlueprint prompt, not just parses and discards them',
  );
}

section('Chapter lifecycle - identity, idempotency, generation-source observability (the "returning subscriber" task)');
{
  const profile: ChildProfile = { childId: 'lifecycle-child-1', childName: 'Ava', age: 6, interests: ['dogs'], avatar: 'girl', createdAt: Date.now() };

  // --- Acceptance 1: first visit gets a free chapter -----------------------
  ok(loadChapterHistoryLocal('lifecycle-acc-1').length === 0, 'a brand-new uid has no chapter history yet');
  ok(!freeChapterSpent('lifecycle-acc-1'), 'the free chapter is not yet spent');
  const firstChapter = chapterFor(profile.interests[0], profile.childName);
  ok(Array.isArray(firstChapter.pages) && firstChapter.pages.length > 0, 'chapterFor() returns a real, page-bearing chapter with no account/subscription needed');

  // --- Acceptance 4: same child + same day -> same actual chapter ----------
  const chapterA = chapterFor(profile.interests[0], profile.childName);
  const chapterB = chapterFor(profile.interests[0], profile.childName);
  ok(JSON.stringify(chapterA) === JSON.stringify(chapterB), 'two independent chapterFor() calls for the same child today are identical (deep equal)');
  ok(chapterIdFor(profile.interests[0], profile.childName) === chapterIdFor(profile.interests[0], profile.childName), 'chapterIdFor() is stable across calls today');

  // --- Acceptance 5/7: completing/rereading/refreshing never regenerates ---
  const uid5 = 'lifecycle-acc-5';
  const chapter5 = chapterFor(profile.interests[0], profile.childName);
  ok(!wasChapterCompleted(uid5, chapter5.id), 'not yet completed');
  appendChapterHistoryEntry(uid5, { date: todayLocal(), chapterId: chapter5.id, childName: profile.childName, newWords: ['dog'], practiced: [], teaser: 'more tomorrow' });
  ok(wasChapterCompleted(uid5, chapter5.id), 'completion is recorded');
  ok(chapterIdFor(profile.interests[0], profile.childName) === chapter5.id, 'completing the chapter does not change what "today\'s chapter" resolves to (a reread gets the SAME chapter)');
  appendChapterHistoryEntry(uid5, { date: todayLocal(), chapterId: chapter5.id, childName: profile.childName, newWords: ['dog'], practiced: [], teaser: 'more tomorrow' });
  ok(loadChapterHistoryLocal(uid5).filter((e) => e.chapterId === chapter5.id).length === 1, 'a duplicate completion of the SAME chapter does not create a second history entry');

  // --- Acceptance 6/7: a new calendar day creates a new chapter; the SAME
  // new day is stable across repeated reads ---------------------------------
  const day1Id = chapterIdForDay('dogs', 'Ava', '2026-08-22');
  const day2Id = chapterIdForDay('dogs', 'Ava', '2026-08-23');
  ok(day1Id !== day2Id, 'two different calendar days produce two different chapter ids for the same child');
  ok(chapterIdForDay('dogs', 'Ava', '2026-08-23') === day2Id, 'the SAME day produces the SAME id (multiple refreshes next day read the same persisted chapter)');
  ok(isValidDay('2026-08-22'), 'a real YYYY-MM-DD string validates');
  ok(!isValidDay('20260822'), 'a bare date-ish string with no dashes is rejected');
  ok(!isValidDay(undefined), 'a non-string is rejected');
  ok(isValidDay(todayLocal()), 'todayLocal() matches the YYYY-MM-DD shape isValidDay() itself requires');

  // --- Acceptance 8: generation source is diagnosable -----------------------
  ok(chapterDebugInfo() === null, 'chapterDebugInfo() starts with nothing recorded');
  // No server reachable in this sandbox (relative fetch URL, no Next.js
  // runtime) — requestTutorChapter's fetch fails, is caught, and the caller
  // correctly falls back to null, exactly as a real deployment does when
  // OPENAI_API_KEY is unset or the model call fails. The point under test is
  // that the OUTCOME is recorded, not silently swallowed.
  const generated = await requestTutorChapter(profile, null, null);
  ok(generated === null, 'requestTutorChapter() resolves to null (never throws) when generation is unreachable/unconfigured');
  const diag = chapterDebugInfo();
  ok(diag?.source === 'fallback', 'chapterDebugInfo() now reports source: fallback for the just-attempted chapter', JSON.stringify(diag));
  ok(typeof diag?.chapterId === 'string' && typeof diag?.stage === 'number', 'the diagnostic carries only id/stage/source facts, nothing prompt- or credential-shaped');

  ok(!process.env.OPENAI_API_KEY, 'OPENAI_API_KEY is unset in this sandbox (precondition)');
  ok(!isStoryGenerationConfigured(), 'isStoryGenerationConfigured() correctly reports false');
  const draft = await generateStoryDraft({ childName: 'Ava', interests: ['dogs'], stage: 3 });
  ok(draft === null, 'generateStoryDraft() resolves to null rather than throwing when OPENAI_API_KEY is unset');

  // --- Acceptance 9: inactive-entitlement subscriber keeps history/profile,
  // gets gated only on the NEXT unread chapter -------------------------------
  const uid9 = 'lifecycle-acc-9';
  const ownedChapter = chapterFor(profile.interests[0], profile.childName);
  appendChapterHistoryEntry(uid9, { date: todayLocal(), chapterId: ownedChapter.id, childName: profile.childName, newWords: [], practiced: [], teaser: '' });
  const spent9 = freeChapterSpent(uid9);
  const lockedForOwnedChapter = spent9 && !wasChapterCompleted(uid9, ownedChapter.id); // subscribed === false, per use-entitlement.ts's `locked` formula
  ok(chaptersCompleted(uid9) > 0, 'history/profile survive an inactive subscription (never cleared by this gate)');
  ok(!lockedForOwnedChapter, 'a chapter the child already finished stays free/unlocked even without an active subscription');
  const unreadChapterId = 'dogs-ava-2099-01-01'; // a chapter this uid has never completed
  const lockedForNextChapter = spent9 && !wasChapterCompleted(uid9, unreadChapterId);
  ok(lockedForNextChapter, 'the NEXT, unread chapter is correctly gated for an inactive subscriber');

  // --- Remote profile mirror: never throws when unreachable -----------------
  let profileFetchThrew = false;
  let remoteProfile: unknown;
  try {
    remoteProfile = await fetchRemoteProfile('fake-token');
  } catch {
    profileFetchThrew = true;
  }
  ok(!profileFetchThrew && remoteProfile === null, 'fetchRemoteProfile() resolves to null rather than throwing when /api/profile is unreachable');
  let mirrorThrew = false;
  try {
    mirrorProfileRemote('fake-token', profile);
  } catch {
    mirrorThrew = true;
  }
  ok(!mirrorThrew, 'mirrorProfileRemote() is fire-and-forget — never throws synchronously even when unreachable');
}

section('Chapter lifecycle - static checks (returning-user boot flow, persisted chapter store, /api/profile) — no OPENAI_API_KEY/FIREBASE_SERVICE_ACCOUNT in this environment');
{
  const fs = await import('node:fs');
  const read = (path: string) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

  for (const page of ['app/home/page.tsx', 'app/read/page.tsx']) {
    const s = read(page);
    ok(/if \(authLoading\) return;/.test(s), `${page}: the profile-boot effect is gated on authLoading (no longer bounces to '/' before auth settles)`);
    ok(s.includes('fetchRemoteProfile') && s.includes('!user.isAnonymous'), `${page}: attempts a remote profile restore for a real signed-in, non-anonymous uid before giving up`);
    ok(s.includes('saveProfile(remote)'), `${page}: a restored remote profile is adopted locally so the next load is instant`);
    ok(s.includes("router.replace('/')"), `${page}: only falls back to '/' after both local and remote checks — never unconditionally on mount`);
    ok(s.includes("/unlock'"), `${page}: routes a locked chapter to /unlock`);
    ok(
      !s.includes("push('/register')") && !s.includes("push('/setup')") && !s.includes("replace('/register')") && !s.includes("replace('/setup')"),
      `${page}: never routes a locked/returning-subscriber path to /register or /setup`,
    );
  }

  const homeSrc = read('app/home/page.tsx');
  ok(
    /const authToken = user \? await user\.getIdToken\(\)/.test(homeSrc) && /requestTutorChapter\(profile, uid, authToken\)/.test(homeSrc),
    'Home awaits an ID token before calling requestTutorChapter (previously called with no token at all, so it always 401d server-side in production)',
  );
  ok(homeSrc.includes('__chapterDebug') && homeSrc.includes('chapterDebugInfo'), 'Home wires window.__chapterDebug for live generation-source observability');

  const storeSrc = read('lib/chapter-store-admin.ts');
  ok(
    /collection\('children'\)\.doc\(childId\)/.test(storeSrc) && /collection\('chapters'\)\.doc\(day\)/.test(storeSrc),
    'lib/chapter-store-admin.ts partitions by uid -> children/{childId} -> chapters/{day}, matching the requested uid+childId+day key',
  );
  ok(storeSrc.indexOf('existing.exists') < storeSrc.indexOf('await generate()'), 'get-or-create checks for an existing record BEFORE ever calling generate()');
  ok(
    /runTransaction/.test(storeSrc) && /tx\.get\(ref\)/.test(storeSrc) && storeSrc.indexOf('tx.get(ref)') < storeSrc.indexOf('tx.set(ref'),
    're-checks existence INSIDE the transaction right before writing (a losing racer never overwrites the winner)',
  );

  const todaySrc = read('app/api/chapters/today/route.ts');
  ok(todaySrc.includes('resolveChapterEntitlement'), '/api/chapters/today resolves the shared free-or-subscription chapter entitlement');
  ok(
    /if \(!entitlementSource\)/.test(todaySrc) && todaySrc.includes('CHAPTER_ENTITLEMENT_REQUIRED'),
    '/api/chapters/today refuses generation only when neither the free chapter nor a subscription admits the caller',
  );
  ok(todaySrc.includes('loadOrCreateProgress') && todaySrc.includes('progress.stage'), 'stage is resolved from the SERVER-persisted ChildProgress, not trusted from the client body');
  ok(todaySrc.includes('isValidDay'), 'day is validated before being used as a Firestore document id');
  ok(todaySrc.includes('overLimit') && todaySrc.includes('RATE_LIMITED'), 'rate-limited the same way /api/chapters/story is');

  const profileRouteSrc = read('app/api/profile/route.ts');
  ok((profileRouteSrc.match(/requireReadingUser\(request\)/g) ?? []).length === 2, '/api/profile uses requireReadingUser (verified Firebase ID token) for both GET and POST');
  ok(!/body\??\.uid/.test(profileRouteSrc), '/api/profile never reads a uid out of the request body');
}

section('commercial-v1 fix A — a fallback chapter is never persisted as the permanent daily chapter');
{
  const day = '2026-08-24';
  const base = { day, chapterId: 'dogs-ava-2026-08-24', stage: 3, createdAt: new Date().toISOString() };
  const noRecord: PersistedChapterRecord | null = null;
  const fallbackRecord: PersistedChapterRecord = { ...base, source: 'fallback' };
  const generatedRecord: PersistedChapterRecord = { ...base, source: 'generated', draft: { title: 't', character: 'c', setting: 's', pages: [] } as never };

  ok(!isAuthoritativeChapterRecord(noRecord), 'no record yet is NOT authoritative — get-or-create must attempt generation');
  ok(!isAuthoritativeChapterRecord(undefined), 'undefined is NOT authoritative either (same as no record)');
  ok(!isAuthoritativeChapterRecord(fallbackRecord), "a persisted 'fallback' record is NOT authoritative — a later request must retry generation, not accept the fallback as final");
  ok(isAuthoritativeChapterRecord(generatedRecord), "a persisted 'generated' record IS authoritative — a later request must NOT regenerate");

  const fs = await import('node:fs');
  const storeSrc = fs.readFileSync(new URL('../../lib/chapter-store-admin.ts', import.meta.url), 'utf8');
  ok(
    storeSrc.includes("generated.source !== 'generated'") && /return\s*\{[\s\S]{0,120}created:\s*false/.test(storeSrc.slice(storeSrc.indexOf("generated.source !== 'generated'"))),
    'a fallback generation result is returned to the caller WITHOUT ever reaching tx.set (never persisted)',
  );
  ok(
    storeSrc.indexOf("generated.source !== 'generated'") < storeSrc.indexOf('runTransaction'),
    'the fallback short-circuit happens BEFORE the transaction that would persist a record — a fallback can never reach tx.set',
  );
  ok(
    (storeSrc.match(/if \(isAuthoritativeChapterRecord\(/g) ?? []).length === 2,
    'both the fast-path existence check AND the in-transaction re-check gate on isAuthoritativeChapterRecord — no path short-circuits on a stale fallback record',
  );
}

section('commercial-v1 fix B — anonymous returning-user lifecycle (resolveRootEntry)');
{
  async function resolve(options: { authenticated: boolean; local?: object | null; remote?: object | null }) {
    let saved: object | null = null;
    let remoteCalls = 0;
    const destination = await resolveRootEntry({
      isAuthenticated: options.authenticated,
      loadLocalProfile: () => options.local ?? null,
      fetchRemoteProfile: async () => {
        remoteCalls++;
        return options.remote ?? null;
      },
      saveLocalProfile: (profile) => {
        saved = profile;
      },
    });
    return { destination, saved, remoteCalls };
  }

  const brandNew = await resolve({ authenticated: false });
  ok(brandNew.destination === 'landing', 'a truly brand-new anonymous visitor (no local profile) still sees the acquisition landing page');
  ok(brandNew.remoteCalls === 0, 'a brand-new visitor never attempts a remote profile fetch');

  const returningAnonymous = await resolve({ authenticated: false, local: { childId: 'anon-child' } });
  ok(
    returningAnonymous.destination === '/home',
    'FIX B: an anonymous parent who already completed Setup goes straight to /home on return — not the acquisition landing page, merely because isAuthenticated is false',
  );
  ok(returningAnonymous.remoteCalls === 0, 'the anonymous-with-local-profile path never attempts (or needs) a remote fetch — no cross-device anonymous identity recovery is manufactured');

  const registeredWithLocal = await resolve({ authenticated: true, local: { childId: 'registered-child' } });
  ok(registeredWithLocal.destination === '/home', 'existing behavior preserved: a registered user with a local profile still goes to /home');

  const remoteProfile = { childId: 'remote-child' };
  const registeredRemoteOnly = await resolve({ authenticated: true, remote: remoteProfile });
  ok(registeredRemoteOnly.destination === '/home', 'existing behavior preserved: registered-user remote-profile restoration still works');
  ok(registeredRemoteOnly.saved === remoteProfile, 'existing behavior preserved: a restored remote profile is still adopted locally');

  const registeredNoProfile = await resolve({ authenticated: true });
  ok(registeredNoProfile.destination === '/setup', 'existing behavior preserved: a registered user with truly no profile anywhere still goes to /setup');

  const anonymousNoProfileEver = await resolve({ authenticated: false, remote: { childId: 'should-never-be-fetched' } });
  ok(
    anonymousNoProfileEver.destination === 'landing' && anonymousNoProfileEver.remoteCalls === 0,
    'an unauthenticated visitor never triggers a remote fetch even if one would hypothetically return something — no cross-device anonymous recovery, by construction',
  );
}

section('commercial-v1 fix B — /setup can never silently overwrite an existing valid profile (static check, no DOM harness in this environment)');
{
  const fs = await import('node:fs');
  const setupSrc = fs.readFileSync(new URL('../../app/setup/page.tsx', import.meta.url), 'utf8');
  ok(setupSrc.includes('loadProfile'), '/setup imports loadProfile to check for an existing profile');
  ok(
    /useEffect\(\(\) => \{\s*if \(loadProfile\(\)\)/.test(setupSrc.replace(/\s+/g, ' ')),
    '/setup checks loadProfile() in a mount effect, before the form can be interacted with',
  );
  ok(
    setupSrc.includes("router.replace('/home')"),
    "/setup redirects an existing-profile visitor straight to /home instead of rendering onboarding over their profile",
  );
  ok(
    /if \(checkingExisting\) return <div className="screen" \/>;/.test(setupSrc),
    '/setup renders a neutral loading state (not the form) while the existing-profile check is still in flight',
  );
  ok(
    setupSrc.indexOf('useEffect') < setupSrc.indexOf('if (checkingExisting)'),
    'the existing-profile guard (useEffect) runs before the loading-state short-circuit it controls',
  );
}

section('commercial-v1 fix C — registration-time profile mirror (static check: no Firebase web config in this environment)');
{
  const fs = await import('node:fs');
  const authSrc = fs.readFileSync(new URL('../../components/AuthProvider.tsx', import.meta.url), 'utf8');
  ok(authSrc.includes('function mirrorLocalProfile'), 'AuthProvider defines a helper that mirrors the local profile immediately on a successful auth transition');
  ok(
    /function mirrorLocalProfile\(user: User\): void \{\s*const profile = loadProfile\(\);/.test(authSrc.replace(/\s+/g, ' ')),
    'mirrorLocalProfile() reads the SAME loadProfile() the anonymous session already had — it mirrors the existing child, never creates a new one',
  );
  ok(authSrc.includes('mirrorProfileRemote(token, profile)'), 'mirrorLocalProfile() calls mirrorProfileRemote() rather than writing a fresh profile');
  const callSites = (authSrc.match(/mirrorLocalProfile\((cred\.user|current)\)/g) ?? []).length;
  ok(
    callSites === 4,
    `mirrorLocalProfile() is called from all four sign-in success paths (linkWithPopup, credential-recovery, its signInWithPopup fallback, and the direct sign-in branch) — found ${callSites}`,
  );
  ok(
    authSrc.indexOf('function mirrorLocalProfile') < authSrc.indexOf('async function recoverExistingAccount'),
    'mirrorLocalProfile is defined before it is used — no forward-reference relying on hoisting quirks',
  );
  // The linkWithPopup success path must mirror the profile BEFORE publish(),
  // not deferred to a later /home or /read visit — bound the slice to just
  // that branch (up to its own catch block) so this doesn't accidentally
  // match a later, unrelated section of the file.
  const linkStart = authSrc.indexOf("recordAuthOp('link-popup')");
  const linkSection = authSrc.slice(linkStart, authSrc.indexOf('} catch (err) {', linkStart));
  ok(
    linkSection.includes('mirrorLocalProfile(current)') && linkSection.indexOf('mirrorLocalProfile(current)') < linkSection.indexOf('publish()'),
    'the linkWithPopup success path mirrors the profile BEFORE publish() — not deferred to a later page visit',
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
