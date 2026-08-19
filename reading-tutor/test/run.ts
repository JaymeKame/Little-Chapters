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
