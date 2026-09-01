import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { modelWordThroughSound, correctionModel, successSoundModel } from '../lib/phonics-model.ts';
import { confidentTrackerWords, TRACKER_CONFIDENCE_MIN } from '../lib/reading-tracker.ts';
import { TutorPhraseSession, deterministicTutorLine } from '../lib/tutor-intents.ts';
import { buildStoryInteractionManifest } from '../lib/story-interactions.ts';
import { buildSessionPlan } from '../lib/session-plan.ts';
import { chapterFor, type Chapter } from '../lib/chapters.ts';

const ship = modelWordThroughSound('shell', 'sh');
assert.equal(ship.some((segment) => segment.text === 'sh'), false, 'sound hunt never depends on a naked synthetic phoneme');
// Correction pass 2, Section 1: pedagogy now leans on REAL reference WORDS
// instead of a stretched isolated phoneme — physical testing showed a
// five-year-old cannot reliably decode "shhhh" from a small speaker, but
// "ship... shoe... shut" is unambiguous. See scripts/test-experience-correction-pass-2.ts
// for the full reference-word contract.
assert.ok(ship.some((segment) => segment.purpose === 'reference-word' && /^ship|^shoe|^shut/.test(segment.text)), 'target sound is taught via real reference words');
assert.ok(ship.filter((segment) => segment.purpose === 'reference-word').length >= 2, 'at least two reference words are spoken');
assert.ok(!ship.some((segment) => /shell/.test(segment.text)), 'the target story word is not given away during the initial model');
assert.ok(ship.every((segment) => typeof segment.holdMs !== 'number' || segment.holdMs >= 200), 'every segment holds ≥200 ms');
assert.deepEqual(successSoundModel('shell', 'sh').map((segment) => segment.purpose), ['instruction','phoneme-model','word-blend']);

const correction = correctionModel('shut', 'sh');
// New wrong-word sequence: identify child choice (optional) → invite listen →
// reference word → target word → compare → retry.
assert.equal(correction[0].text, 'Listen again.', 'correction opens with re-listen when no child choice is known');
assert.ok(correction.some((segment) => segment.purpose === 'reference-word'), 'correction models a reference word');
assert.ok(correction.some((segment) => segment.text === 'shut.'), 'correction voices the target word');
assert.equal(correction.at(-1)?.text, 'Try one more time.');

const tutor = new TutorPhraseSession();
const first = tutor.line('EASY_SUCCESS'); const second = tutor.line('EASY_SUCCESS');
assert.notEqual(first, second, 'session history avoids immediate repeated success phrases');
assert.ok(deterministicTutorLine('MODEL_WORD', { word:'shell' }).includes('shell'), 'every intent has a deterministic contextual fallback');

const confident = confidentTrackerWords([
  { word:'Maya', accuracy:TRACKER_CONFIDENCE_MIN, errorType:'None', offsetMs:0, durationMs:100, phonemes:[] },
  { word:'bridge', accuracy:50, errorType:'Mispronunciation', offsetMs:100, durationMs:100, phonemes:[] },
  { word:'water', accuracy:null, errorType:'None', offsetMs:200, durationMs:100, phonemes:[] },
]);
assert.deepEqual(confident, ['Maya'], 'only finalized high-confidence words advance the tracker');

const chapter: Chapter = { ...chapterFor('ocean','Maya'), id:'distinct-maya-ocean', character:'Maya', companion:'a small turtle', setting:'an underwater glass city',
  pages:[{text:'Maya crossed a shell bridge.',focusWords:['shell']},{text:'A pearl flashed below.',focusWords:['pearl']},{text:'The turtle found a cave.',focusWords:['cave']},{text:'Maya opened the gate.',focusWords:['gate']},{text:'Warm light filled the city.',focusWords:['light']}],
  cliffhanger:['A new doorway shimmered.','Tomorrow…'],teaser:'The doorway waits.',phonics:[{hint:'sh in shell',words:['shell']}], provenance:{source:'generated'} };
const manifest = buildStoryInteractionManifest(chapter);
assert.ok(manifest.scenes.every((scene) => scene.narrativeBeat && scene.importantAction && scene.location));
assert.ok(manifest.scenes.slice(1).every((scene) => scene.previousSceneContinuity));
assert.ok(manifest.beats.some((beat) => beat.mechanicType === 'find-it-in-scene'));
// Correction sprint Sections 15-20: the session planner now composes each
// day's mechanic sequence — the shape is no longer fixed. The invariants
// worth asserting here are that the plan still opens with welcome, closes
// with ending, and contains at least one interaction beat overall.
const dailyPlan = buildSessionPlan(chapter, 'Maya');
assert.equal(dailyPlan[0].kind, 'welcome', 'plan opens with welcome');
assert.equal(dailyPlan.at(-1)!.kind, 'ending', 'plan closes with ending');
assert.ok(dailyPlan.some((beat) => beat.kind === 'sound-hunt' || beat.kind === 'find-in-scene' || beat.kind === 'prediction' || beat.kind === 'word-builder'), 'plan contains at least one composed interaction beat');

const fallback = chapterFor('trains','Ari');
assert.equal(fallback.character, 'Ari');
assert.doesNotMatch(JSON.stringify(fallback), /Chug/, 'fallback repetition does not force the old theme mascot');

const pronunciation = readFileSync('lib/pronunciation.ts','utf8');
const readPage = readFileSync('app/read/page.tsx','utf8');
assert.equal((pronunciation.match(/getUserMedia\(/g) ?? []).length, 1, 'microphone acquisition has one application owner');
assert.doesNotMatch(readPage.slice(readPage.indexOf('function armSilenceStop'), readPage.indexOf('async function beginListening')), /beginListening|getUserMedia/, 'silence timer only finishes the current take; it never reacquires permission');
assert.match(readPage,/function armSilenceStop\(ms = 8000\)/, 'ordinary thinking silence no longer ends the take after only three seconds');

const webmanifest = JSON.parse(readFileSync('public/manifest.webmanifest','utf8'));
assert.equal(webmanifest.display,'standalone'); assert.equal(webmanifest.start_url,'/');
// Correction pass 2, Section 7: manifest reverted to the pre-sprint icon
// paths pending an approved permanent Little Chapters mark from the user;
// see the acceptance report's item 14 for the candidate ambiguity.
assert.ok(webmanifest.icons.length >= 2, 'manifest ships the pre-sprint icon paths');
assert.ok(webmanifest.icons.every((icon: { src: string }) => icon.src.startsWith('/pwa/icon-')), 'icons reference /pwa/ paths only');
const settings = readFileSync('app/settings/page.tsx','utf8');
assert.match(settings,/shouldShowInstallPrompt/); assert.match(settings,/dismissInstallPrompt/);
assert.doesNotMatch(readPage,/shouldShowInstallPrompt/, 'install onboarding never appears in the child reading session');

console.log('Commercial experience sprint: assertions passed.');
