import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildStoryInteractionManifest, resolveStoryInteractionManifest } from '../lib/story-interactions.ts';
import { loadChapterScenePackage, requestChapterScenePackage, scenePackageCacheKey, type ChapterScenePackage } from '../lib/chapter-scenes.ts';
import type { Chapter } from '../lib/chapters.ts';

const memory = new Map<string,string>();
Object.defineProperty(globalThis, 'localStorage', { value: { getItem:(key:string)=>memory.get(key) ?? null, setItem:(key:string,value:string)=>memory.set(key,value), removeItem:(key:string)=>memory.delete(key), clear:()=>memory.clear(), key:(index:number)=>[...memory.keys()][index] ?? null, get length(){ return memory.size; } }, configurable:true });

function chapter(id:string, character:string, setting:string, ambience:Chapter['ambience'], objects:string[]): Chapter {
  return { id, title:"Today's Chapter", character, companion:objects[0], setting, ambience,
    pages:[
      { text:`${character} found a ${objects[0]}.`, focusWords:[objects[0]] },
      { text:`The ${objects[0]} led to a ${objects[1]}.`, focusWords:[objects[1]] },
      { text:`A ${objects[2]} began to move.`, focusWords:[objects[2]] },
      { text:`${character} went past the ${objects[1]}.`, focusWords:[objects[1]] },
      { text:`The ${objects[2]} opened at last.`, focusWords:[objects[2]] },
    ], cliffhanger:[`The ${objects[2]} opened and light filled the scene.`, 'Tomorrow…'], teaser:`Tomorrow, ${character} follows the light.`, phonics:[{ hint:`sh in ${objects[0]}`, words:[objects[0]] }] };
}

const chapters = [
  chapter('underwater','Nia','a turquoise underwater city','ocean',['shell','cave','submarine']),
  chapter('dinosaur','Pip','a fern-filled dinosaur valley','jungle',['track','nest','egg']),
  chapter('bakery','Mara','a warm magical bakery','fantasy',['dish','oven','cake']),
];
for (const value of chapters) {
  const manifest = buildStoryInteractionManifest(value);
  assert.equal(manifest.scenes.length, 4);
  assert.deepEqual(manifest.beats.map((beat)=>beat.mechanicType), ['find-sound','what-happens-next','final-story-unlock']);
  assert.ok(manifest.scenes.every((scene)=>scene.visualPrompt.includes(value.setting)));
  assert.equal(JSON.stringify(manifest).includes('Chug'), false);
}

memory.clear();
const firstManifest = resolveStoryInteractionManifest(chapters[0]);
const secondManifest = resolveStoryInteractionManifest(chapters[0]);
assert.deepEqual(secondManifest, firstManifest);
assert.ok(memory.has('little-chapters-interaction-manifest:underwater'));

const mockPackage: ChapterScenePackage = { chapterId:'underwater', visualBibleVersion:1, provider:'mock-provider', generatedAt:'2026-01-01T00:00:00.000Z', generationLatencyMs:1234,
  scenes:firstManifest.scenes.map((scene)=>({ sceneId:scene.sceneId, assetUrl:`https://storage.test/underwater/${scene.sceneId}.webp`, visualPurpose:scene.visualPurpose, entities:[] })) };
memory.delete(scenePackageCacheKey('underwater'));
let calls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => { calls += 1; return new Response(JSON.stringify({ scenePackage:mockPackage }), { status:200, headers:{'Content-Type':'application/json'} }); }) as typeof fetch;
assert.deepEqual(await requestChapterScenePackage(chapters[0], firstManifest, null), mockPackage);
assert.deepEqual(await requestChapterScenePackage(chapters[0], firstManifest, null), mockPackage);
assert.equal(calls, 1, 'refresh/same-browser reuse must not call generation again');
memory.delete(scenePackageCacheKey('underwater'));
globalThis.fetch = (async () => new Response(JSON.stringify({ error:'SCENE_GENERATION_FAILED' }), { status:503 })) as typeof fetch;
assert.equal(await requestChapterScenePackage(chapters[0], firstManifest, null), null, 'provider failure selects approved runtime fallback');
globalThis.fetch = originalFetch;
assert.equal(loadChapterScenePackage('underwater'), null);

const route = readFileSync('app/api/chapters/visuals/route.ts','utf8');
assert.ok(route.indexOf('const existing = await ref.get()') < route.indexOf('generatePackage(chapter)'), 'durable lookup precedes generation');
assert.match(route, /2-by-2 storyboard/);
assert.match(route, /sharp\(normalized\)\.extract/);
assert.match(route, /chapter-scenes\/\$\{safe\}\/v\$\{VISUAL_BIBLE_VERSION\}/);
assert.match(route, /chapterScenePackages/);

console.log('Chapter scene generation: 21 passed, 0 failed');
