import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { modelWordThroughSound, correctionModel } from '../lib/phonics-model.ts';
import { confidentTrackerWords, TRACKER_CONFIDENCE_MIN } from '../lib/reading-tracker.ts';
import { TutorPhraseSession, deterministicTutorLine } from '../lib/tutor-intents.ts';
import { buildStoryInteractionManifest } from '../lib/story-interactions.ts';
import { buildSessionPlan } from '../lib/session-plan.ts';
import { chapterFor, type Chapter } from '../lib/chapters.ts';

const ship = modelWordThroughSound('ship', 'sh');
assert.equal(ship.some((segment) => segment.text === 'sh'), false, 'sound hunt never depends on a naked synthetic phoneme');
// Correction sprint Sections 6-7: the target sound is stretched, then the
// rime follows as its own utterance, then the whole word is spoken — each
// with a real hold. `shhhh-ip` (a hyphenated single utterance) has been
// retired in favor of separate segments with pauses so the child has time
// to hear each part.
assert.ok(ship.some((segment) => segment.purpose === 'phoneme-model' && /shhhh/.test(segment.text)), '/sh/ is stretched as its own segment');
assert.ok(ship.some((segment) => segment.purpose === 'rime' && /ip/.test(segment.text)), 'rime "ip" is spoken as its own segment with a hold');
assert.ok(ship.some((segment) => segment.purpose === 'word-blend' && /ship/.test(segment.text)), 'the whole word is spoken as the acoustic anchor');
assert.ok(ship.every((segment) => typeof segment.holdMs !== 'number' || segment.holdMs >= 0), 'per-segment holds are well-formed');
assert.ok(ship.find((segment) => segment.purpose === 'phoneme-model')!.holdMs! >= 420, 'phoneme modeling gets real listening time');

const correction = correctionModel('shut', 'sh');
assert.deepEqual(correction.map((segment) => segment.purpose), ['instruction','instruction','phoneme-model','rime','word-blend','retry'], 'wrong-word correction models identify→beginning→stretched-sound→rime→whole-word→invite');
assert.equal(correction[0].text, 'This word is shut.', 'wrong-word correction opens by naming the correct word');
assert.equal(correction.at(-1)?.text, 'Your turn.');
assert.ok(correction.find((segment) => segment.purpose === 'phoneme-model')!.holdMs! >= 420, 'correction phoneme model paces for listening');

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
assert.ok(manifest.scenes.every((scene) => scene.narrativeBeat && scene.importantAction && scene.location === chapter.setting));
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
// Correction sprint Section 24-25: SVG source alongside the maskable PNGs.
assert.ok(webmanifest.icons.length >= 3, 'manifest ships SVG + maskable PNG icons');
assert.ok(webmanifest.icons.some((icon: { src: string; type: string }) => icon.src === '/pwa/icon.svg' && icon.type === 'image/svg+xml'), 'manifest declares the permanent Little Chapters SVG identity');
assert.ok(webmanifest.icons.every((icon: { src: string }) => !/child|avatar|profile|face|kid/i.test(icon.src)), 'no child-profile image controls the app icon');
const settings = readFileSync('app/settings/page.tsx','utf8');
assert.match(settings,/shouldShowInstallPrompt/); assert.match(settings,/dismissInstallPrompt/);
assert.doesNotMatch(readPage,/shouldShowInstallPrompt/, 'install onboarding never appears in the child reading session');

console.log('Commercial experience sprint: assertions passed.');
