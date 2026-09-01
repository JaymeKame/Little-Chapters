import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateStoryDraft, type StoryGenerationParams } from '../lib/story-generator.server.ts';
import { chapterForDay } from '../lib/chapters.ts';
import { chapterStoryFingerprint } from '../lib/chapter-scenes.ts';
import { resolveAuthorizedChapterDay } from '../lib/qa-day.ts';
import { illegalStage1Blueprint } from './test-stage1-literacy-realization.ts';

const originalKey = process.env.OPENAI_API_KEY;
const originalModel = process.env.OPENAI_STORY_MODEL;
const originalFetch = globalThis.fetch;
const params: StoryGenerationParams = { childName: 'Mike', companionName: 'Momo', interests: ['trains'], stage: 3 };

async function main() {
  delete process.env.OPENAI_API_KEY;
  const absent = await generateStoryDraft(params);
  assert.equal(absent.ok, false);
  if (!absent.ok) assert.equal(absent.reason, 'not-configured');

  process.env.OPENAI_API_KEY = 'test-only';
  process.env.OPENAI_STORY_MODEL = 'fixture-model';
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{"error":"limited"}', { status:429 }); };
  const limitedOnce = await generateStoryDraft(params);
  assert.equal(limitedOnce.ok, false);
  if (!limitedOnce.ok) assert.equal(limitedOnce.reason, 'provider-429');
  assert.equal(calls, 1, '429 is permanent and never retried');

  calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{"error":"unauthorized"}', { status:401 }); };
  const unauthorized = await generateStoryDraft(params);
  assert.equal(unauthorized.ok, false);
  if (!unauthorized.ok) assert.equal(unauthorized.reason, 'provider-401');
  assert.equal(calls, 1, '401 is permanent and never retried');

  calls = 0;
  globalThis.fetch = async () => new Response('{"error":"limited"}', { status: 429, headers: { 'Content-Type':'application/json' } });
  const limited = await generateStoryDraft(params);
  assert.equal(limited.ok, false);
  if (!limited.ok) {
    assert.equal(limited.reason, 'provider-429');
    assert.deepEqual(limited.diagnostic.attempts.map((row) => row.httpStatus), [429]);
    assert.ok(limited.diagnostic.attempts.every((row) => row.providerReached && row.model === 'fixture-model'));
  }

  const validBlueprint = illegalStage1Blueprint('Mike', 'Momo', 'a quiet station', 'map');
  const recoveryParams = { ...params, stage: 1 };
  calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response('{"error":"transient"}', { status:500 });
    return new Response(JSON.stringify({ choices:[{ message:{ content:JSON.stringify(validBlueprint) } }] }), { status:200 });
  };
  const recovered = await generateStoryDraft(recoveryParams);
  assert.equal(recovered.ok, true, 'the single transient retry accepts a valid semantic plan');
  assert.equal(recovered.diagnostic.attempts[0].httpStatus, 500);
  assert.equal(recovered.diagnostic.attempts[1].httpStatus, 200);
  assert.equal(calls, 2, 'one transient retry may recover');

  calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{"error":"transient"}', { status:500 }); };
  const exhaustedTransient = await generateStoryDraft(params);
  assert.equal(exhaustedTransient.ok, false);
  if (!exhaustedTransient.ok) assert.equal(exhaustedTransient.reason, 'provider-5xx');
  assert.equal(calls, 2, 'transient provider failure is capped at two calls');

  globalThis.fetch = async () => new Response(JSON.stringify({ choices:[{ message:{ content:'{}' } }] }), { status:200, headers:{'Content-Type':'application/json'} });
  const malformed = await generateStoryDraft(params);
  assert.equal(malformed.ok, false);
  if (!malformed.ok) {
    assert.equal(malformed.reason, 'semantic-blueprint-validation');
    assert.ok(malformed.diagnostic.attempts.every((row) => row.ruleCodes.includes('invalid-blueprint-shape')));
  }

  const fallback = chapterForDay('trains', 'Mike', '2026-09-01');
  assert.equal(fallback.id, 'trains-mike-2026-09-01');
  const replacement = { ...fallback, pages: fallback.pages.map((page, index) => index ? page : { ...page, text: `${page.text} New event.` }) };
  assert.notEqual(chapterStoryFingerprint(fallback), chapterStoryFingerprint(replacement), 'new story content cannot reuse fallback art identity');
  assert.equal(resolveAuthorizedChapterDay({ day:'2026-09-01', qaDay:'2099-01-01', qaMode:true, vercelEnvironment:'production' }), '2026-09-01');
  assert.equal(resolveAuthorizedChapterDay({ day:'2026-09-01', qaDay:'2099-01-01', qaMode:true, vercelEnvironment:'preview' }), '2099-01-01');

  const todayRoute = readFileSync('app/api/chapters/today/route.ts', 'utf8');
  const visualRoute = readFileSync('app/api/chapters/visuals/route.ts', 'utf8');
  const welcome = readFileSync('lib/session-plan.ts', 'utf8');
  assert.match(todayRoute, /dailyChapterRef\(chapterId\)\.set/);
  assert.match(todayRoute, /storySource: record\.source/);
  assert.match(visualRoute, /ownedDailyChapter\(auth\.uid, requestedChapter\.id\)/);
  assert.match(visualRoute, /chapterStoryFingerprint\(chapter\)/);
  assert.doesNotMatch(welcome, /has a new mystery for us/);
  assert.match(welcome, /Your new story is ready/);
  console.log('Generation outcomes passed: safe provider/validator provenance, fallback ownership, fingerprinted art, neutral welcome');
}

main().finally(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.OPENAI_STORY_MODEL; else process.env.OPENAI_STORY_MODEL = originalModel;
}).catch((error) => { console.error(error); process.exitCode = 1; });
