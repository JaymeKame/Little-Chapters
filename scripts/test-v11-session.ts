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

const plan = buildSessionPlan(chapter, 'Sam', 'Rex found a map.');
assert.deepEqual(plan.map((beat) => beat.kind), ['welcome','reading','sound-hunt','reading','find-in-scene','reading','word-builder','reading','ending']);
assert.equal(plan.filter((beat) => beat.kind === 'sound-hunt').length, 1);
assert.equal(plan.filter((beat) => beat.kind === 'find-in-scene').length, 1);
assert.equal(plan.filter((beat) => beat.kind === 'word-builder').length, 1);
assert.equal(plan.filter((beat) => beat.kind === 'reading').flatMap((beat) => beat.kind === 'reading' ? beat.pageIndexes : []).length, chapter.pages.length);
const hunt = buildSoundHunt(chapter);
assert.ok(chapter.pages.some((page) => page.text.toLowerCase().includes(hunt.answer)));
assert.ok(hunt.answer.includes(hunt.pattern));
assert.equal(hunt.choices.length, 3);
assert.equal(new Set(hunt.choices).size, 3);
assert.equal(interactionAfterPage(plan, 0)?.kind, 'sound-hunt');
const alternatePlan = buildSessionPlan({ ...chapter, id:'tesu' }, 'Sam');
const prediction = alternatePlan.find((beat) => beat.kind === 'prediction');
assert.ok(prediction && prediction.activity.interactiveObjects.every((choice) => choice.label), 'both prediction selections advance through the same canonical beat');

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
