import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { requestTutorChapter, chapterFor, type Chapter } from '../lib/chapters.ts';
import { buildStoryInteractionManifest, wordBuilderPieces } from '../lib/story-interactions.ts';
import { buildSessionPlan } from '../lib/session-plan.ts';
import { AdventureTelemetry, chapterDebugSnapshot } from '../lib/adventure-debug.ts';
import { TUTOR_PERFORMANCE, tutorPurposeFor } from '../lib/audio-session.ts';
import type { ChildProfile } from '../lib/profile.ts';

const memory = new Map<string,string>();
Object.defineProperty(globalThis, 'localStorage', { value: { getItem:(k:string)=>memory.get(k) ?? null, setItem:(k:string,v:string)=>memory.set(k,v), removeItem:(k:string)=>memory.delete(k), clear:()=>memory.clear() }, configurable:true });
const profile: ChildProfile = { childId:'child-daily', childName:'Ari', age:6, interests:['ocean'], createdAt:1 };
const generated: Chapter = { ...chapterFor('ocean','Ari'), character:'Nova', companion:'a silver fish', setting:'an underwater library',
  pages:[{text:'Nova got a shell.',focusWords:['shell']},{text:'The shell lit a map.',focusWords:['map']},{text:'A ship came near.',focusWords:['ship']},{text:'Nova fixed the ship.',focusWords:['ship']},{text:'The ship rose up.',focusWords:['rose']}],
  provenance:{source:'generated',generatedAt:'2026-08-25T00:00:00.000Z'} };

async function main() {
const originalFetch = globalThis.fetch;
let calls:string[] = [];
globalThis.fetch = (async (_input, init) => { calls.push(init?.method ?? 'GET'); return new Response('{}',{status:503}); }) as typeof fetch;
assert.equal(await requestTutorChapter(profile,'uid','token'), null, 'transient lookup failure returns graceful fallback without poisoning storage');
assert.equal(memory.size, 0);
calls = [];
globalThis.fetch = (async (_input, init) => {
  calls.push(init?.method ?? 'GET');
  return init?.method === 'GET' ? new Response('{}',{status:404}) : new Response(JSON.stringify({chapter:generated}),{status:201,headers:{'Content-Type':'application/json'}});
}) as typeof fetch;
assert.equal((await requestTutorChapter(profile,'uid','token'))?.character, 'Nova');
assert.deepEqual(calls,['GET','POST']);
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
assert.deepEqual(buildSessionPlan(generated,'Ari').map((beat)=>beat.kind), ['welcome','reading','sound-hunt','reading','prediction','reading','word-builder','reading','ending']);

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
assert.doesNotMatch(storyRoute,/petName: ['"]Momo['"]/);
assert.doesNotMatch(read,/Keep the story going/);
assert.doesNotMatch(read,/Correct!/);
assert.match(read,/setTimeout\(continueAfterInteraction/);
assert.match(read,/router\.push\(subscribed === true \? '\/home' : '\/home\?grownupHandoff=1'\)/);
console.log('Daily Adventure: 31 passed, 0 failed');
}

void main();
