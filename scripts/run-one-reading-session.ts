/* Phase 3 of the integration-spine task: feed one full reading session
 * through the adapter (lib/reading-signal-adapter.ts) and then through
 * reading-tutor's interpretSession(), and print the canonical output.
 *
 *   node scripts/run-one-reading-session.ts
 *
 * LIMITATION, stated plainly: there is no real recorded child audio or
 * captured Azure/MDD response anywhere in this repo (checked — no .wav
 * fixtures, reading-tutor/bench/manifest.json is present but empty, only
 * manifest.example.json exists as a template). This run therefore uses
 * REPRESENTATIVE per-word measurements — realistic timings and score
 * distributions modeled on how lib/pronunciation.ts actually shapes Azure
 * output — applied to the REAL demo chapter text from lib/chapters.ts
 * (STORY_SKELETONS[0], the 'dogs' interest chapter, character=Rex). This is
 * not a synthesized "clean" pass: it includes a genuine mispronunciation, a
 * skipped word, a long hesitation, and a slowly sounded-out word, spread
 * across three real pages, specifically so the session is NOT trivially
 * excluded (minCountableWords=12 — this session has 31 countable words)
 * and produces a non-empty, informative SessionReading.
 *
 * Does NOT call applySession() or touch progression. Does NOT persist
 * anything. Does NOT print anything a parent or child would see — this is
 * a developer console log proving the pipe works end to end, per the
 * integration-spine brief's Phase 3 scope.                                */

import { toSentenceResult } from '../lib/reading-signal-adapter.ts';
import type { WordScore } from '../lib/pronunciation.ts';
import type { SentenceResult, SessionInput } from '../reading-tutor/src/types.ts';
import { interpretSession } from '../reading-tutor/src/interpret.ts';

/* ── Page 1: "Rex raced across the field. Something shiny sat under the gate."
 * Real text: lib/chapters.ts STORY_SKELETONS[0].pages[0], slots resolved
 * (character=Rex, place=field, spot=gate for the 'dogs' interest).
 * One genuine mispronunciation ("raced"), one long hesitation ("across"). */
const page1Text = 'Rex raced across the field. Something shiny sat under the gate.';
const page1Words: WordScore[] = [
  { word: 'Rex', accuracy: 92, errorType: 'None', offsetMs: 300, durationMs: 280,
    phonemes: [{ phoneme: 'r', accuracy: 90 }, { phoneme: 'ɛ', accuracy: 95 }, { phoneme: 'ks', accuracy: 91 }] },
  { word: 'raced', accuracy: 38, errorType: 'Mispronunciation', offsetMs: 650, durationMs: 410,
    phonemes: [{ phoneme: 'r', accuracy: 85 }, { phoneme: 'eɪ', accuracy: 22 }, { phoneme: 's', accuracy: 40 }, { phoneme: 't', accuracy: 45 }] },
  { word: 'across', accuracy: 88, errorType: 'None', offsetMs: 2400, durationMs: 520,
    phonemes: [{ phoneme: 'ə', accuracy: 90 }, { phoneme: 'k', accuracy: 41 }, { phoneme: 'r', accuracy: 92 }, { phoneme: 'ɒ', accuracy: 89 }, { phoneme: 's', accuracy: 94 }] },
  { word: 'the', accuracy: 95, errorType: 'None', offsetMs: 2960, durationMs: 150,
    phonemes: [{ phoneme: 'ð', accuracy: 93 }, { phoneme: 'ə', accuracy: 96 }] },
  { word: 'field', accuracy: 81, errorType: 'None', offsetMs: 3150, durationMs: 480,
    phonemes: [{ phoneme: 'f', accuracy: 88 }, { phoneme: 'iː', accuracy: 79 }, { phoneme: 'l', accuracy: 80 }, { phoneme: 'd', accuracy: 82 }] },
  { word: 'Something', accuracy: 90, errorType: 'None', offsetMs: 4100, durationMs: 520,
    phonemes: [{ phoneme: 's', accuracy: 91 }, { phoneme: 'ʌ', accuracy: 88 }, { phoneme: 'm', accuracy: 92 }, { phoneme: 'θ', accuracy: 89 }, { phoneme: 'ɪ', accuracy: 90 }, { phoneme: 'ŋ', accuracy: 91 }] },
  { word: 'shiny', accuracy: 93, errorType: 'None', offsetMs: 4650, durationMs: 400,
    phonemes: [{ phoneme: 'ʃ', accuracy: 92 }, { phoneme: 'aɪ', accuracy: 94 }, { phoneme: 'n', accuracy: 93 }, { phoneme: 'i', accuracy: 94 }] },
  { word: 'sat', accuracy: 96, errorType: 'None', offsetMs: 5080, durationMs: 260,
    phonemes: [{ phoneme: 's', accuracy: 95 }, { phoneme: 'æ', accuracy: 97 }, { phoneme: 't', accuracy: 96 }] },
  { word: 'under', accuracy: 89, errorType: 'None', offsetMs: 5370, durationMs: 350,
    phonemes: [{ phoneme: 'ʌ', accuracy: 87 }, { phoneme: 'n', accuracy: 90 }, { phoneme: 'd', accuracy: 88 }, { phoneme: 'ə', accuracy: 91 }] },
  { word: 'the', accuracy: 94, errorType: 'None', offsetMs: 5760, durationMs: 140,
    phonemes: [{ phoneme: 'ð', accuracy: 93 }, { phoneme: 'ə', accuracy: 95 }] },
  { word: 'gate', accuracy: 91, errorType: 'None', offsetMs: 5940, durationMs: 340,
    phonemes: [{ phoneme: 'g', accuracy: 90 }, { phoneme: 'eɪ', accuracy: 91 }, { phoneme: 't', accuracy: 92 }] },
];

/* ── Page 2: "It was a little gold key. Who lost it?"
 * Real text: STORY_SKELETONS[0].pages[1], slot adj=gold. Clean read. */
const page2Text = 'It was a little gold key. Who lost it?';
const page2Words: WordScore[] = [
  { word: 'It', accuracy: 95, errorType: 'None', offsetMs: 200, durationMs: 160, phonemes: [{ phoneme: 'ɪ', accuracy: 94 }, { phoneme: 't', accuracy: 96 }] },
  { word: 'was', accuracy: 90, errorType: 'None', offsetMs: 400, durationMs: 220, phonemes: [{ phoneme: 'w', accuracy: 89 }, { phoneme: 'ʌ', accuracy: 90 }, { phoneme: 'z', accuracy: 91 }] },
  { word: 'a', accuracy: 97, errorType: 'None', offsetMs: 660, durationMs: 100, phonemes: [{ phoneme: 'ə', accuracy: 97 }] },
  { word: 'little', accuracy: 87, errorType: 'None', offsetMs: 800, durationMs: 380, phonemes: [{ phoneme: 'l', accuracy: 85 }, { phoneme: 'ɪ', accuracy: 88 }, { phoneme: 't', accuracy: 86 }, { phoneme: 'əl', accuracy: 89 }] },
  { word: 'gold', accuracy: 92, errorType: 'None', offsetMs: 1220, durationMs: 340, phonemes: [{ phoneme: 'g', accuracy: 91 }, { phoneme: 'oʊ', accuracy: 93 }, { phoneme: 'l', accuracy: 90 }, { phoneme: 'd', accuracy: 93 }] },
  { word: 'key', accuracy: 94, errorType: 'None', offsetMs: 1600, durationMs: 260, phonemes: [{ phoneme: 'k', accuracy: 93 }, { phoneme: 'iː', accuracy: 95 }] },
  { word: 'Who', accuracy: 89, errorType: 'None', offsetMs: 2200, durationMs: 240, phonemes: [{ phoneme: 'h', accuracy: 88 }, { phoneme: 'uː', accuracy: 90 }] },
  { word: 'lost', accuracy: 91, errorType: 'None', offsetMs: 2470, durationMs: 320, phonemes: [{ phoneme: 'l', accuracy: 90 }, { phoneme: 'ɒ', accuracy: 91 }, { phoneme: 's', accuracy: 92 }, { phoneme: 't', accuracy: 91 }] },
  { word: 'it', accuracy: 93, errorType: 'None', offsetMs: 2820, durationMs: 150, phonemes: [{ phoneme: 'ɪ', accuracy: 92 }, { phoneme: 't', accuracy: 94 }] },
];

/* ── Page 3: "Rex looked and looked. A tiny path went up the hill."
 * Real text: STORY_SKELETONS[0].pages[2]. One skipped word ("and"), one
 * slowly sounded-out word ("hill"). */
const page3Text = 'Rex looked and looked. A tiny path went up the hill.';
const page3Words: WordScore[] = [
  { word: 'Rex', accuracy: 93, errorType: 'None', offsetMs: 250, durationMs: 270, phonemes: [{ phoneme: 'r', accuracy: 92 }, { phoneme: 'ɛ', accuracy: 94 }, { phoneme: 'ks', accuracy: 93 }] },
  { word: 'looked', accuracy: 90, errorType: 'None', offsetMs: 600, durationMs: 380, phonemes: [{ phoneme: 'l', accuracy: 89 }, { phoneme: 'ʊ', accuracy: 91 }, { phoneme: 'k', accuracy: 90 }, { phoneme: 't', accuracy: 89 }] },
  // Skipped outright - LCS alignment already synthesizes this as an Omission
  // with no real timestamp (see lib/pronunciation.ts alignWords()).
  { word: 'and', accuracy: null, errorType: 'Omission', offsetMs: null, durationMs: null, phonemes: [] },
  { word: 'looked', accuracy: 88, errorType: 'None', offsetMs: 1400, durationMs: 360, phonemes: [{ phoneme: 'l', accuracy: 87 }, { phoneme: 'ʊ', accuracy: 88 }, { phoneme: 'k', accuracy: 89 }, { phoneme: 't', accuracy: 87 }] },
  { word: 'A', accuracy: 96, errorType: 'None', offsetMs: 1850, durationMs: 110, phonemes: [{ phoneme: 'ə', accuracy: 96 }] },
  { word: 'tiny', accuracy: 91, errorType: 'None', offsetMs: 2000, durationMs: 340, phonemes: [{ phoneme: 't', accuracy: 90 }, { phoneme: 'aɪ', accuracy: 92 }, { phoneme: 'n', accuracy: 91 }, { phoneme: 'i', accuracy: 92 }] },
  { word: 'path', accuracy: 89, errorType: 'None', offsetMs: 2400, durationMs: 320, phonemes: [{ phoneme: 'p', accuracy: 88 }, { phoneme: 'æ', accuracy: 90 }, { phoneme: 'θ', accuracy: 88 }] },
  { word: 'went', accuracy: 92, errorType: 'None', offsetMs: 2780, durationMs: 280, phonemes: [{ phoneme: 'w', accuracy: 91 }, { phoneme: 'ɛ', accuracy: 93 }, { phoneme: 'n', accuracy: 92 }, { phoneme: 't', accuracy: 92 }] },
  { word: 'up', accuracy: 95, errorType: 'None', offsetMs: 3110, durationMs: 180, phonemes: [{ phoneme: 'ʌ', accuracy: 95 }, { phoneme: 'p', accuracy: 96 }] },
  { word: 'the', accuracy: 94, errorType: 'None', offsetMs: 3330, durationMs: 140, phonemes: [{ phoneme: 'ð', accuracy: 93 }, { phoneme: 'ə', accuracy: 95 }] },
  // Sounded out slowly (child worked it out letter by letter) but got there
  // with decent accuracy - the "took a long time but read it" case.
  { word: 'hill', accuracy: 79, errorType: 'None', offsetMs: 3520, durationMs: 1900,
    phonemes: [{ phoneme: 'h', accuracy: 82 }, { phoneme: 'ɪ', accuracy: 77 }, { phoneme: 'l', accuracy: 78 }] },
];

function buildSentence(index: number, text: string, words: WordScore[]): SentenceResult {
  return toSentenceResult(index, text, words).sentence;
}

const session: SessionInput = {
  childId: 'demo-child-1',
  sessionId: 'demo-session-' + new Date().toISOString().slice(0, 10),
  stage: 2,
  chapterId: 'the-shiny-thing:dogs',
  isBookshelfReread: false,
  startedAt: new Date().toISOString(),
  sentences: [
    buildSentence(0, page1Text, page1Words),
    buildSentence(1, page2Text, page2Words),
    buildSentence(2, page3Text, page3Words),
  ],
};

const reading = interpretSession(session);

console.log('=== SessionInput (adapter output, fed into interpretSession) ===');
console.log(`  sentences: ${session.sentences.length}, total words: ${session.sentences.reduce((n, s) => n + s.words.length, 0)}`);

console.log('\n=== SessionReading (canonical interpretSession() output) ===');
console.log('sessionId:', reading.sessionId);
console.log('stage:', reading.stage);
console.log('countedWords:', reading.countedWords);
console.log('excludedWords:', reading.excludedWords);
console.log('assistedShare:', reading.assistedShare);
console.log('excludedFromProgression:', reading.excludedFromProgression);
console.log('excludedReason:', reading.excludedReason ?? '(none — this session counts)');
console.log('trickyWords:', reading.trickyWords);
console.log('cleanWords:', reading.cleanWords, '(empty — no previouslyTricky was passed in for this demo)');
console.log(
  'accuracy: [present in memory only — NEVER PERSIST, NEVER SHOW TO PARENT/CHILD, per SessionReading\'s own doc comment. Not printed here on purpose.]',
);

console.log('\n=== Per-word verdicts (words[], the full canonical detail) ===');
for (const w of reading.words) {
  const tag = w.excludedBecause ? `excluded(${w.excludedBecause})` : w.verdict;
  console.log(`  ${w.word.padEnd(10)} ${tag.padEnd(20)} ${w.reason}`);
}

console.log(
  '\nNo persistence, no applySession(), no progression touched. This log is a',
  'developer console check only — nothing here is a score shown to a child or parent.',
);
