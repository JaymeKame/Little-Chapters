import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chapterFor } from '../lib/chapters.ts';
import { buildStoryInteractionManifest } from '../lib/story-interactions.ts';
import { fallbackBlueprintForChapter, RESOLUTION_TYPES } from '../lib/story-blueprint.ts';

const chapter = chapterFor('dogs', 'Maya');
chapter.pages = [
  { text: 'Maya found the little gate.', focusWords: ['gate'] },
  { text: 'Momo pushed the gate open.', focusWords: ['open'] },
  { text: 'A map shone under the gate.', focusWords: ['map'] },
  { text: 'Maya followed the map home.', focusWords: ['home'] },
  { text: 'The friends found the lost pup.', focusWords: ['pup'] },
];
chapter.storyBlueprint = fallbackBlueprintForChapter({ protagonist: 'Maya', companion: 'Momo', setting: chapter.setting, pages: chapter.pages });
const manifest = buildStoryInteractionManifest(chapter);
const order = manifest.beats.find((beat) => beat.mechanicType === 'story-order')!;
assert.equal(order.storyOrder?.prompt, 'What happened first?');
assert.equal(order.storyOrder?.events[0].caption, 'Maya found the little gate.');
assert.equal(order.storyOrder?.events[1].caption, 'Momo pushed the gate open.');
assert.equal(order.correctTarget, order.storyOrder?.events[0].beatId);
assert.ok(order.interactiveObjects.every((choice) => choice.caption && choice.visualSceneId));
assert.ok(order.interactiveObjects.every((choice) => !/^(event[ -]?\d+|first|second)$/i.test(choice.caption!)));

const find = manifest.beats.find((beat) => beat.mechanicType === 'find-it-in-scene')!;
const sourcePage = chapter.pages.findIndex((page) => page.text.toLowerCase().includes(find.correctTarget!.toLowerCase()));
const sourceScene = manifest.scenes.find((scene) => scene.pageIndexes.includes(sourcePage))!;
assert.equal(find.visualSceneId, sourceScene.sceneId, 'find-story-word owns the scene where its target appeared');

const resolutionTypes = new Set<string>();
for (let seed = 0; seed < 30; seed += 1) {
  const pages = chapter.pages.map((page, index) => ({ ...page, text: `${page.text.slice(0, -1)} ${seed + index}.` }));
  resolutionTypes.add(fallbackBlueprintForChapter({ protagonist: 'Maya', companion: 'Momo', setting: `${chapter.setting} ${seed}`, pages }).resolutionType!);
}
assert.ok(resolutionTypes.size >= 6, `expected at least six resolution functions, got ${[...resolutionTypes].join(', ')}`);
assert.ok([...resolutionTypes].every((type) => RESOLUTION_TYPES.includes(type as (typeof RESOLUTION_TYPES)[number])));

for (const path of ['app/privacy/page.tsx','app/terms/page.tsx','app/support/page.tsx']) {
  const source = readFileSync(path, 'utf8');
  assert.doesNotMatch(source, /DRAFT|pending counsel review|TODO|lorem ipsum|Event 1|Event 2/i, `${path} must not expose production placeholders`);
}

console.log(`Physical QA contract passed: story-grounded order, interaction scene ownership, ${resolutionTypes.size} fallback resolution functions`);
