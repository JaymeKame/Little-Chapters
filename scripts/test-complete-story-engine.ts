import assert from 'node:assert/strict';
import { chapterFor } from '../lib/chapters.ts';
import { buildStoryInteractionManifest, isValidPredictionCaption } from '../lib/story-interactions.ts';
import { blueprintGenerationPrompt, materializeStoryPages, predictionCaptionIssues, validateStoryBlueprint } from '../lib/story-blueprint.ts';
import { modelWordThroughSound, semanticTurnText } from '../lib/phonics-model.ts';
import { buildSessionPlan } from '../lib/session-plan.ts';

const chapter = chapterFor('trains', 'Mike');
const blueprint = chapter.storyBlueprint!;
assert.ok(blueprint, 'offline and generated chapters both carry a pre-session blueprint');
assert.equal(validateStoryBlueprint(blueprint).ok, true, JSON.stringify(validateStoryBlueprint(blueprint).issues));
assert.equal(blueprint.prediction.optionA.consequenceBeat.cause, 'The child chose branch A.');
assert.equal(blueprint.prediction.optionB.consequenceBeat.cause, 'The child chose branch B.');

const base = materializeStoryPages(blueprint, null);
const branchA = materializeStoryPages(blueprint, 'A');
const branchB = materializeStoryPages(blueprint, 'B');
const consequenceIndex = blueprint.prediction.afterPageIndex + 1;
assert.notEqual(branchA[consequenceIndex].text, base[consequenceIndex].text);
assert.notEqual(branchB[consequenceIndex].text, base[consequenceIndex].text);
assert.notEqual(branchA[consequenceIndex].text, branchB[consequenceIndex].text, 'choice selects different pre-authored consequences');
assert.equal(branchA.at(-1)?.text, branchB.at(-1)?.text, 'both authored paths coherently reconverge before the ending');

for (const bad of ['Mike follows the behind.', 'Mike follows the sat.', 'Mike next.', 'Something happens.', 'The next thing.', 'What happens next.']) {
  assert.ok(predictionCaptionIssues(bad, 'Mike').length > 0, `reject ${bad}`);
  assert.equal(isValidPredictionCaption(bad), false);
}
for (const good of ['Mike follows the glowing footprints.', 'Mike checks behind the old bridge.', 'Mike opens the tiny wooden door.']) {
  assert.equal(predictionCaptionIssues(good, 'Mike').length, 0, `accept ${good}`);
}

const manifest = buildStoryInteractionManifest(chapter);
const prediction = manifest.beats.find((beat) => beat.mechanicType === 'what-happens-next')!;
assert.deepEqual(prediction.interactiveObjects.map((option) => option.caption), [blueprint.prediction.optionA.caption, blueprint.prediction.optionB.caption]);
assert.ok(manifest.scenes.every((scene) => scene.visualPrompt.includes('STORY BEAT:') && scene.visualPrompt.includes('VISIBLE CHANGE SINCE PRIOR BEAT:')));
const order = manifest.beats.find((beat) => beat.mechanicType === 'story-order')!;
assert.ok(order.interactiveObjects.length >= 2 && order.interactiveObjects.length <= 4);
assert.ok(buildSessionPlan(chapter, 'Mike', '', manifest).some((beat) => beat.kind === 'story-order'));

const turn = semanticTurnText(modelWordThroughSound('shell', 'sh'));
assert.equal(turn, 'Listen to these words. ship... shoe... shut... Listen to how they begin. Which story word starts the same way?');

const prompt = blueprintGenerationPrompt({ childName: 'Sam', companionName: 'Pip', interests: ['trains'], childContext: 'Loves trains, silly dogs, and building forts', stage: 2, targetWords: ['map'] });
assert.match(prompt, /Loves trains, silly dogs, and building forts/);
assert.match(prompt, /never override safety or reading constraints/);

console.log('Complete story engine contract passed: blueprint, branches, semantics, visuals, order game, context, and one-turn speech');
