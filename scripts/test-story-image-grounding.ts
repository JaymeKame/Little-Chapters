import assert from 'node:assert/strict';
import { chapterForDay, type Chapter } from '../lib/chapters.ts';
import { buildStoryInteractionManifest } from '../lib/story-interactions.ts';
import type { StoryBlueprint, StoryBlueprintBeat, StoryState } from '../lib/story-blueprint.ts';
import { illegalStage1Blueprint } from './test-stage1-literacy-realization.ts';

const chapter = chapterForDay('space', 'Sally', '2026-09-09');
const state = (location: string): StoryState => ({ location, charactersPresent: ['Sally', chapter.companion], knownObjects: [], carriedObjects: [], discoveredObjects: [], unresolvedGoal: 'goal-1', previousAction: null, consequences: [] });
const actions = ['opens the hatch', 'spots a silver map', 'lifts the moon key', 'crosses the glass bridge', 'fits the key in the lock', 'finds the home beacon', 'waves from the safe ship'];
const objects = ['hatch', 'map', 'key', 'bridge', 'lock', 'beacon', 'ship'];
const beats: StoryBlueprintBeat[] = actions.map((action, index) => ({ beatId: `beat-${index + 1}`, role: index === 0 ? 'opening' : index === 6 ? 'resolution' : 'discovery', summary: action, cause: index ? actions[index - 1] : null, action, visibleChange: `${objects[index]} appears`, requiredVisibleObjects: [objects[index]], emotionalPurpose: 'wonder', stateBefore: state(`location-${index + 1}`), stateAfter: state(`location-${index + 1}`) }));
chapter.pages = Array.from({ length: 6 }, (_, index) => ({ text: `Sally ${actions[index + 1] ?? actions[index]}.`, focusWords: ['map'], scene: 'space', semanticBeatId: `beat-${index + 2}` }));
const baseBlueprint = illegalStage1Blueprint('Sally', chapter.companion, chapter.setting, 'map');
chapter.storyBlueprint = { ...baseBlueprint, beats, pages: chapter.pages, prediction: { ...baseBlueprint.prediction, reconvergenceBeatId: 'beat-6' }, goalResolutionBeatId: 'beat-7' } satisfies StoryBlueprint;
const manifest = buildStoryInteractionManifest(chapter as Chapter);
assert.equal(manifest.scenes.length, 4);
assert.deepEqual(manifest.scenes[0].semanticBeatIds, ['beat-2', 'beat-3']);
assert.deepEqual(manifest.scenes[1].semanticBeatIds, ['beat-4']);
assert.deepEqual(manifest.scenes[2].semanticBeatIds, ['beat-5', 'beat-6']);
assert.deepEqual(manifest.scenes[3].semanticBeatIds, ['beat-7']);
for (const scene of manifest.scenes) {
  assert.match(scene.visualPrompt, new RegExp(scene.importantAction.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(scene.visualPrompt, new RegExp(scene.location));
  assert.ok(scene.importantObjects.some((object) => scene.visualPrompt.includes(object)));
  assert.ok(scene.charactersPresent.every((character) => scene.visualPrompt.includes(character)));
}
assert.equal(manifest.scenes[1].importantAction, 'crosses the glass bridge');
assert.notEqual(manifest.scenes[1].importantAction, beats[1].action, 'regression: scene index must not select beat[index]');
console.log('story-image grounding: PASS');
