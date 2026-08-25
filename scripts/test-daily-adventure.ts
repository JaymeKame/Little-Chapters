import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { requestTutorChapter, chapterFor, type Chapter } from '../lib/chapters.ts';
import { buildStoryInteractionManifest, wordBuilderPieces } from '../lib/story-interactions.ts';
import { buildSessionPlan } from '../lib/session-plan.ts';
import { AdventureTelemetry, chapterDebugSnapshot } from '../lib/adventure-debug.ts';
import { TUTOR_PERFORMANCE, tutorPurposeFor } from '../lib/audio-session.ts';
import type { ChildProfile } from '../lib/profile.ts';
import { decideChapterEntitlement } from '../lib/chapter-entitlement-policy.ts';

const memory = new Map<string,string>();
Object.defineProperty(globalThis, 'localStorage', { value: { getItem:(k:string)=>memory.get(k) ?? null, setItem:(k:string,v:string)=>memory.set(k,v), removeItem:(k:string)=>memory.delete(k), clear:()=>memory.clear() }, configurable:true });
const profile: ChildProfile = { childId:'child-daily', childName:'Ari', age:6, interests:['ocean'], createdAt:1 };
const generated: Chapter = { ...chapterFor('ocean','Ari'), character:'Nova', companion:'a silver fish', setting:'an underwater library',
  pages:[{text:'Nova got a shell.',focusWords:['shell']},{text:'The shell lit a map.',focusWords:['map']},{text:'A ship came near.',focusWords:['ship']},{text:'Nova fixed the ship.',focusWords:['ship']},{text:'The ship rose up.',focusWords:['rose']}],
  provenance:{source:'generated',generatedAt:'2026-08-25T00:00:00.000Z'} };

async function main() {
const originalFetch = globalThis.fetch;
let calls:string[] = []; let generationBody: { profile?: ChildProfile; stage?: unknown; ageDerivedStageEstimate?: unknown; recentlyMissedWords?: unknown; storySoFar?: unknown; skeletonId?: unknown } = {};
globalThis.fetch = (async (_input, init) => { calls.push(init?.method ?? 'GET'); return new Response('{}',{status:503}); }) as typeof fetch;
assert.equal(await requestTutorChapter(profile,'uid','token'), null, 'transient lookup failure returns graceful fallback without poisoning storage');
assert.equal(memory.size, 0);
calls = [];
globalThis.fetch = (async (_input, init) => {
  calls.push(init?.method ?? 'GET');
  if (init?.method === 'POST') generationBody = JSON.parse(String(init.body)) as typeof generationBody;
  return init?.method === 'GET' ? new Response('{}',{status:404}) : new Response(JSON.stringify({chapter:generated}),{status:201,headers:{'Content-Type':'application/json'}});
}) as typeof fetch;
assert.equal((await requestTutorChapter(profile,'uid','token'))?.character, 'Nova');
assert.deepEqual(calls,['POST'], 'the authoritative persisted today endpoint owns lookup + create atomically');
assert.equal(generationBody.profile?.childName,'Ari');
assert.deepEqual(generationBody.profile?.interests,['ocean']);
assert.equal(typeof (generationBody.stage ?? generationBody.ageDerivedStageEstimate),'number');
assert.ok('recentlyMissedWords' in generationBody && 'storySoFar' in generationBody && 'skeletonId' in generationBody);
calls = [];
assert.equal((await requestTutorChapter(profile,'uid','token'))?.provenance?.source, 'cached-generated');
assert.deepEqual(calls,[], 'refresh reuses the successful generated chapter');
globalThis.fetch = originalFetch;

assert.deepEqual(wordBuilderPieces('ship'), ['sh','i','p']);
assert.deepEqual(wordBuilderPieces('light'), ['l','igh','t']);
const manifest = buildStoryInteractionManifest(generated);
const builder = manifest.beats.find((beat)=>beat.mechanicType === 'word-builder')!;
assert.ok(builder.interactiveObjects.length >= 2);
assert.equal(builder.interactiveObjects.map((part)=>part.label).join(''), builder.correctTarget);
assert.equal(JSON.stringify(manifest).match(/Chug|Rex|Momo/g), null, 'daily engine has no fixed-character assumptions');
// Correction sprint Sections 15-20: the session composer varies which
// mechanic lands in each slot. Assert the plan is well-formed and contains
// at least one interaction — not a specific mechanic in a specific slot.
const generatedPlan = buildSessionPlan(generated,'Ari');
assert.equal(generatedPlan[0].kind, 'welcome');
assert.equal(generatedPlan.at(-1)!.kind, 'ending');
assert.ok(generatedPlan.some((beat) => beat.kind === 'sound-hunt' || beat.kind === 'find-in-scene' || beat.kind === 'prediction' || beat.kind === 'word-builder'), 'plan contains at least one composed interaction');
assert.equal(decideChapterEntitlement({chapterId:'today',subscribed:false,consumedFreeChapterId:null}),'free');
assert.equal(decideChapterEntitlement({chapterId:'today',subscribed:true,consumedFreeChapterId:null}),'subscription');
assert.equal(decideChapterEntitlement({chapterId:'tomorrow',subscribed:false,consumedFreeChapterId:'today'}),null);
assert.equal(decideChapterEntitlement({chapterId:'today',existingSource:'free',subscribed:false,consumedFreeChapterId:'today'}),'free');

assert.equal(tutorPurposeFor('sound-hunt-retry'),'phoneme-model');
assert.equal(tutorPurposeFor('chapter-ending'),'cliffhanger');
assert.ok(TUTOR_PERFORMANCE.instruction.rate < TUTOR_PERFORMANCE.celebration.rate);
assert.ok(TUTOR_PERFORMANCE['phoneme-model'].rate < TUTOR_PERFORMANCE.instruction.rate);

const telemetry = new AdventureTelemetry();
telemetry.count('reading'); telemetry.count('game'); telemetry.count('correction'); telemetry.count('utterance'); telemetry.enter('interaction');
const timing = telemetry.snapshot(Date.now() + 100);
assert.equal(timing.readingBeats,1); assert.equal(timing.gameBeats,1); assert.equal(timing.corrections,1); assert.equal(timing.tutorUtterances,1);
assert.ok(chapterDebugSnapshot(generated,null,telemetry).chapterSource === 'generated');

const read = readFileSync('app/read/page.tsx','utf8');
const storyRoute = readFileSync('app/api/chapters/story/route.ts','utf8');
const completionRoute = readFileSync('app/api/progress/complete-session/route.ts','utf8');
const visualRoute = readFileSync('app/api/chapters/visuals/route.ts','utf8');
assert.doesNotMatch(storyRoute,/petName: ['"]Momo['"]/);
assert.doesNotMatch(storyRoute,/SUBSCRIPTION_REQUIRED/);
assert.match(storyRoute,/resolveChapterEntitlement/);
assert.match(read,/appendChapterHistoryEntry/);
assert.match(read,/grownupHandoff=1/);
assert.match(completionRoute,/consumeFreeChapterIfApplicable\(auth\.uid, body\.sessionInput\.chapterId\)/);
assert.match(visualRoute,/ownedDailyChapter/);
assert.doesNotMatch(visualRoute,/hasActiveSubscription/);
assert.doesNotMatch(read,/Keep the story going/);
assert.doesNotMatch(read,/Correct!/);
assert.match(read,/setTimeout\(continueAfterInteraction/);
assert.match(read,/router\.push\(subscribed === true \? '\/home' : '\/home\?grownupHandoff=1'\)/);
console.log('Daily Adventure: 31 passed, 0 failed');
}

void main();
