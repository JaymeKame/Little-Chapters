import { strict as assert } from 'node:assert';
import { buildSessionPlan, buildSoundHunt, claimEndingCompletion, interactionAfterPage } from '../lib/session-plan.ts';
import { normalizePreferences } from '../lib/preference-values.ts';
import type { Chapter } from '../lib/chapters.ts';
import { buildStoryInteractionManifest } from '../lib/story-interactions.ts';

const chapter: Chapter = {
  id:'test', title:"Today's Chapter", character:'Rex', companion:'Momo', setting:'a warm forest', ambience:'countryside',
  pages:[
    { text:'Rex sat by the red gate.', focusWords:['red'] }, { text:'A ship came past the path.', focusWords:['ship'] },
    { text:'Rex saw a little map.', focusWords:['map'] }, { text:'The map led up the hill.', focusWords:['hill'] },
    { text:'A bright door began to open.', focusWords:['bright'] },
  ], cliffhanger:['The door opened.','Tomorrow…'], teaser:'Rex looks behind the door.',
  phonics:[{ hint:'sh in ship', words:['ship'] }, { hint:'short vowels', words:['map','red'] }],
};

// Correction sprint Sections 15-20: the plan's SPINE is stable (welcome, four
// reading clusters, ending); the three interaction slots between clusters are
// composed per-day, so the exact mechanic sequence varies. Assert invariants
// rather than a fixed sequence — the composed plan for one chapter still
// covers the same page count and terminates cleanly.
const plan = buildSessionPlan(chapter, 'Sam', 'Rex found a map.');
assert.equal(plan[0].kind, 'welcome');
assert.equal(plan.at(-1)!.kind, 'ending');
assert.equal(plan.filter((beat) => beat.kind === 'reading').length, 4, 'four reading clusters');
const interactionKinds = plan.filter((beat) => beat.kind === 'sound-hunt' || beat.kind === 'find-in-scene' || beat.kind === 'prediction' || beat.kind === 'word-builder').map((beat) => beat.kind);
assert.ok(interactionKinds.length >= 1 && interactionKinds.length <= 3, 'plan carries 1–3 composed interactions');
assert.equal(plan.filter((beat) => beat.kind === 'reading').flatMap((beat) => beat.kind === 'reading' ? beat.pageIndexes : []).length, chapter.pages.length);
const hunt = buildSoundHunt(chapter);
assert.ok(chapter.pages.some((page) => page.text.toLowerCase().includes(hunt.answer)));
assert.ok(hunt.answer.includes(hunt.pattern));
assert.equal(hunt.choices.length, 3);
assert.equal(new Set(hunt.choices).size, 3);
const alternatePlan = buildSessionPlan({ ...chapter, id:'tesu' }, 'Sam');
// Two different chapter ids may or may not produce two different sequences
// (the composer is deterministic, not required to disagree), but a
// prediction beat, if present, must still be well-formed.
const prediction = alternatePlan.find((beat) => beat.kind === 'prediction');
if (prediction) {
  assert.ok(prediction.activity.interactiveObjects.every((choice) => choice.label), 'prediction beat still has well-formed choices');
}

const manifest = buildStoryInteractionManifest({ ...chapter, id:'underwater', character:'Nia', companion:'Turtle', setting:'an underwater city' });
assert.equal(manifest.visualBible.protagonist, 'Nia');
assert.equal(manifest.scenes.length >= 3 && manifest.scenes.length <= 5, true);
assert.ok(manifest.scenes.every((scene) => scene.visualPrompt.includes('underwater city')));
assert.ok(manifest.scenes.every((scene) => scene.visualPrompt.includes(manifest.visualBible.style) && scene.visualPrompt.includes(manifest.visualBible.forbiddenStyles[0])));
assert.ok(manifest.beats.every((beat) => beat.spokenInstruction && beat.visualSceneId && beat.transitionTarget));
assert.equal(JSON.stringify(manifest).includes('Chug'), false);

assert.deepEqual(normalizePreferences({ music:'off', communication:'sms', difficultyObservation:'too-hard', phoneNumber:'555' }), {
  music:'off', communication:'sms', difficultyObservation:'too-hard', phoneNumber:'555',
});
assert.equal(normalizePreferences({ music:'invalid' as never }).music, 'normal');

const endingLatch = { current: false };
assert.equal(claimEndingCompletion(endingLatch), true);
assert.equal(claimEndingCompletion(endingLatch), false);

console.log('V1.1 session/settings: 20 passed, 0 failed');
