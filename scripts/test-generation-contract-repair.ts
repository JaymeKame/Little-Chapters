import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chapterForDay } from '../lib/chapters.ts';
import { selectStaticSceneSequence } from '../lib/scene-selector.ts';
import { blueprintGenerationPrompt, normalizeStoryBlueprint, predictionCaptionIssues, validateStoryBlueprint } from '../lib/story-blueprint.ts';
import { storyLiteracyContract, targetedRepairInstructions } from '../lib/story-generator.server.ts';
import { imageRepairFeedback, reviewPasses, safeReviewerReasonCodes } from '../lib/image-review-contract.ts';
import { allowedWordsForStage, getStage } from '../reading-tutor/content/stages.ts';
import { canonicalReadingStartEnabled } from '../lib/canonical-session.ts';
import { resolveAuthorizedChapterDay } from '../lib/qa-day.ts';

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem:()=>null, setItem:()=>undefined } });

for (const stage of [1, 3, 5, 10]) {
  const contract = storyLiteracyContract(stage, 'Mike', 'Momo', ['map', 'astronaut', 'tap']);
  assert.deepEqual(contract.sentenceLength, getStage(stage).sentence_length);
  assert.ok(contract.currentVocabulary.every((word) => allowedWordsForStage(stage).has(word)));
  assert.ok(contract.previewVocabulary.every((word) => !allowedWordsForStage(stage).has(word)));
  assert.ok(contract.targetWords.every((word) => contract.currentVocabulary.includes(word) || contract.previewVocabulary.includes(word)));
  const prompt = blueprintGenerationPrompt({ childName:'Mike', companionName:'Momo', interests:['trains'], stage, targetWords:contract.targetWords, literacy:contract });
  assert.match(prompt, /CURRENT VOCABULARY:/);
  assert.match(prompt, /PREVIEW VOCABULARY:/);
  assert.match(prompt, new RegExp(`contain ${contract.sentenceLength.min}-${contract.sentenceLength.max} words`));
  assert.match(prompt, /APPROVED PROPER NOUNS ONLY: Mike, Momo/);
  assert.match(prompt, /LEGAL ACTION WORDS/);
}

for (const caption of ['Mike can tap the red map.', 'Mike carries the small red bag.', 'Mike builds a safe little bridge.', 'Mike reaches the top of the hill.']) {
  assert.deepEqual(predictionCaptionIssues(caption, 'Mike'), [], `valid action: ${caption}`);
}
for (const caption of ['Mike follows the behind.', 'Mike follows the sat.', 'Mike can behind the old bridge.', 'Momo can tap the red map.']) {
  assert.ok(predictionCaptionIssues(caption, 'Mike').length, `invalid fragment/subject: ${caption}`);
}

const chapter = chapterForDay('trains', 'Mike', '2026-09-02');
const source = structuredClone(chapter.storyBlueprint!);
source.beats[2].stateBefore = { ...source.beats[2].stateBefore, knownObjects:[] };
source.beats[2].requiredVisibleObjects = ['new map'];
source.beats[2].stateAfter.discoveredObjects = [];
source.resolution = 'Mike is safe and smiles.'; // deliberately no lexical copy of the goal
const normalized = normalizeStoryBlueprint(source);
assert.ok(normalized.beats[2].stateAfter.discoveredObjects.includes('new map'));
assert.equal(validateStoryBlueprint(normalized).issues.some((issue) => issue.code === 'unexplained-entity'), false);
assert.equal(validateStoryBlueprint(normalized).issues.some((issue) => issue.code === 'unresolved-ending'), false, 'structured goal pointer replaces brittle last-token matching');
const brokenEnding = { ...normalized, goalResolutionBeatId:'missing-beat' };
assert.equal(validateStoryBlueprint(brokenEnding).issues.some((issue) => issue.code === 'unresolved-ending'), true);

const repair = targetedRepairInstructions(['phonics/not-decodable','phonics/too-many-preview-words','phonics/sentence-length','content/unknown-proper-noun','malformed-prediction','unresolved-ending','unexplained-entity'], storyLiteracyContract(3, 'Mike', 'Momo', ['map']), ['spaceship']);
for (const phrase of ['CURRENT VOCABULARY','no more than 2','exactly 5-7','only capitalized names','can <legal action>','goalResolutionBeatId','discoveredObjects']) assert.match(repair, new RegExp(phrase));

const panels = [1,2,3,4].map((panel) => ({ panel, settingMatches:true, characterMatches:true, actionMatches:true, noContradiction:true, meaningfullyDifferent:true, continuityMatches:true, confidence:0.9 }));
assert.equal(reviewPasses(false, panels, 4), true, 'global false cannot contradict four passing panel contracts');
panels[1].actionMatches = false;
assert.equal(reviewPasses(true, panels, 4), false, 'global true cannot rescue a deficient panel');
assert.match(imageRepairFeedback(panels, ['Panel 2 action mismatch']), /Panel 2: repair action matches/);
assert.deepEqual(safeReviewerReasonCodes(['Panel 2 action mismatch!', 'Panel 2 action mismatch!']), ['panel-2-action-mismatch']);

const sequence = selectStaticSceneSequence(chapter, [0,1,2,3].map((pageIndex) => ({ sceneId:`scene-${pageIndex + 1}`, page:chapter.pages[0], pageIndex })), undefined, null);
assert.equal(new Set(Object.values(sequence).map((selection) => selection.asset.src)).size, 4, 'four authored scenes use four approved assets while the pool permits');

const visualRoute = readFileSync('app/api/chapters/visuals/route.ts', 'utf8');
const todayRoute = readFileSync('app/api/chapters/today/route.ts', 'utf8');
const readPage = readFileSync('app/read/page.tsx', 'utf8');
assert.match(visualRoute, /attempt <= 2/);
assert.doesNotMatch(visualRoute, /attempt <= 3/);
assert.match(visualRoute, /ImageCallError/);
assert.match(visualRoute, /imageRepairFeedback/);
assert.match(visualRoute, /imageGenerationDiagnostic: imageDiagnostic/);
assert.match(visualRoute, /diagnostic: error instanceof ImageGenerationError/);
assert.match(visualRoute, /ownedDailyChapter\(auth\.uid, requestedChapter\.id\)/, 'visual ownership guard remains intact');
assert.ok(todayRoute.indexOf('await dailyChapterRef(chapterId).set') < todayRoute.lastIndexOf('return NextResponse.json({ record, chapter, created })'), 'generated or fallback ownership is persisted before response');
assert.doesNotMatch(readPage, /setChapter\(chapterFor\(/, 'Read cannot mount a disposable demo chapter');
assert.match(readPage, /storyRequestStatus !== 'resolved' \|\| !canonicalOwnershipReady/, 'visual request waits for canonical ownership');

const ready = { storyRequestStatus:'resolved' as const, canonicalChapterId:'dogs-mina-2099-09-02', activeChapterId:'dogs-mina-2099-09-02', storyRequestChapterId:'dogs-mina-2099-09-02', visualRequestChapterId:'dogs-mina-2099-09-02', canonicalOwnershipReady:true };
assert.equal(canonicalReadingStartEnabled(ready), true);
assert.equal(canonicalReadingStartEnabled({ ...ready, activeChapterId:'dogs-mina-2026-09-01' }), false);
assert.equal(canonicalReadingStartEnabled({ ...ready, visualRequestChapterId:null }), false);
assert.equal(canonicalReadingStartEnabled({ ...ready, canonicalOwnershipReady:false }), false);
assert.equal(resolveAuthorizedChapterDay({ day:'2099-09-02', qaDay:'2099-09-02', qaMode:true, vercelEnvironment:'production', productionDay:'2026-09-01' }), '2026-09-01');

console.log('Generation contract repair passed: literacy, targeted repair, prediction grammar, structured goal/state, reviewer repair, unique static scenes');
