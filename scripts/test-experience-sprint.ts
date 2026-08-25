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
assert.ok(ship.some((segment) => /shhhh-ip/.test(segment.text)), '/sh/ is stretched inside a real word');
assert.deepEqual(correctionModel('shut', 'sh').map((segment) => segment.purpose), ['instruction','instruction','phoneme-model','word-blend','retry']);
assert.equal(correctionModel('shut', 'sh').at(-1)?.text, 'Your turn.');

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
assert.ok(['prediction','find-in-scene'].includes(buildSessionPlan(chapter,'Maya')[4].kind), 'daily plan selects one visual-comprehension mechanic rather than every mechanic');

const fallback = chapterFor('trains','Ari');
assert.equal(fallback.character, 'Ari');
assert.doesNotMatch(JSON.stringify(fallback), /Chug/, 'fallback repetition does not force the old theme mascot');

const pronunciation = readFileSync('lib/pronunciation.ts','utf8');
const readPage = readFileSync('app/read/page.tsx','utf8');
assert.equal((pronunciation.match(/getUserMedia\(/g) ?? []).length, 1, 'microphone acquisition has one application owner');
assert.doesNotMatch(readPage.slice(readPage.indexOf('function armSilenceStop'), readPage.indexOf('async function beginListening')), /beginListening|getUserMedia/, 'silence timer only finishes the current take; it never reacquires permission');
assert.match(readPage,/function armSilenceStop\(ms = 8000\)/, 'ordinary thinking silence no longer ends the take after only three seconds');

const webmanifest = JSON.parse(readFileSync('public/manifest.webmanifest','utf8'));
assert.equal(webmanifest.display,'standalone'); assert.equal(webmanifest.start_url,'/'); assert.equal(webmanifest.icons.length,2);
const settings = readFileSync('app/settings/page.tsx','utf8');
assert.match(settings,/shouldShowInstallPrompt/); assert.match(settings,/dismissInstallPrompt/);
assert.doesNotMatch(readPage,/shouldShowInstallPrompt/, 'install onboarding never appears in the child reading session');

console.log('Commercial experience sprint: 22 assertions passed, 0 failed');
