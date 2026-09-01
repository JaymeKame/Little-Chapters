import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { chapterForDay } from '../lib/chapters.ts';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
const qaDay = '2099-09-02';
const canonical = chapterForDay('dogs', 'Mina', qaDay);
canonical.provenance = { source:'generated', sessionDay:qaDay, qaDayRequested:qaDay, qaDayAuthorized:qaDay };

async function main() {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  const chapterRequests:string[] = [];
  const visualRequests:Array<{ method:string; body:string }> = [];
  await page.route('**/api/health', (route) => route.fulfill({ status:200, contentType:'application/json', body:'{"capabilities":{}}' }));
  await page.route('**/api/chapters/story**', async (route, request) => {
    chapterRequests.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`);
    if (request.method() === 'GET') return route.fulfill({ status:404, contentType:'application/json', body:'{}' });
    await new Promise((resolve) => setTimeout(resolve, 700));
    return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ chapter:canonical }) });
  });
  await page.route('**/api/chapters/visuals**', async (route, request) => {
    visualRequests.push({ method:request.method(), body:request.postData() ?? '' });
    if (request.method() === 'GET') return route.fulfill({ status:404, contentType:'application/json', body:'{}' });
    return route.fulfill({ status:503, contentType:'application/json', body:'{"reason":"fixture-no-image"}' });
  });
  await page.goto(BASE_URL);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('little-chapters-profile', JSON.stringify({ childId:'fixture-child', childName:'Mina', age:6, interests:['dogs','space','ocean'], createdAt:Date.now() }));
  });
  await page.goto(`${BASE_URL}/read?debug=1&skipWelcome=1&qaDay=${qaDay}`);
  await page.getByText('Getting your story ready…').waitFor();
  await page.screenshot({ path:'/tmp/little-chapters-canonical-loading.png', fullPage:true });
  assert.equal(visualRequests.length, 0, 'visual generation cannot fire while the canonical story is pending');
  assert.equal(await page.locator('[data-read-state="loading"]').count(), 1);
  await page.waitForFunction(() => typeof (window as any).__chapterDebug === 'function' && (window as any).__chapterDebug().canonicalSession?.readingStartEnabled === true);
  const debug = await page.evaluate(() => (window as any).__chapterDebug());
  assert.equal(debug.canonicalSession.placeholderChapterId, null);
  assert.equal(debug.canonicalSession.sessionDay, qaDay);
  assert.equal(debug.canonicalSession.qaDayAuthorized, qaDay);
  assert.equal(debug.canonicalSession.activeChapterId, canonical.id);
  assert.equal(debug.canonicalSession.canonicalChapterId, canonical.id);
  assert.equal(debug.canonicalSession.storyRequestChapterId, canonical.id);
  assert.equal(debug.canonicalSession.visualRequestChapterId, canonical.id);
  assert.equal(debug.canonicalSession.canonicalOwnershipReady, true);
  assert.equal(debug.canonicalSession.readingStartEnabled, true);
  assert.ok(chapterRequests.every((request) => !request.includes('2026-09-01')), 'no real-calendar placeholder request during QA run');
  assert.ok(visualRequests.every((request) => !request.body || request.body.includes(canonical.id)), 'visual POST is bound to canonical chapter');
  assert.equal(JSON.stringify(debug).includes('demo/static'), false);
  await page.screenshot({ path:'/tmp/little-chapters-canonical-startup.png', fullPage:true });
  await browser.close();
  console.log('Canonical reader startup passed: no disposable chapter, one QA identity, visuals wait for canonical ownership');
}

main().catch((error) => { console.error(error); process.exit(1); });
