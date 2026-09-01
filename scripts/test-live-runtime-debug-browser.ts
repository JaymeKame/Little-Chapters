import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
const candidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
];

async function main() {
  const executablePath = candidates.find((path): path is string => Boolean(path && existsSync(path)));
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const chapterRequests: string[] = [];
  await page.route('**/api/chapters/**', (route, request) => {
    chapterRequests.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`);
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    build: { commitSha: 'fixture-sha', branch: 'fixture-branch', buildTime: '2026-08-31T00:00:00.000Z' },
    capabilities: { openai:{configured:true}, openai_images:{configured:true}, firebase_admin:{configured:true}, firebase_storage:{configured:true} },
  }) }));
  await page.goto(BASE_URL);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('little-chapters-profile', JSON.stringify({ childId:'debug-child', childName:'Mike', age:6, interests:['dogs','space','ocean'], createdAt:Date.now() }));
  });
  await page.goto(`${BASE_URL}/read?skipWelcome=1`);
  assert.equal(await page.evaluate(() => typeof (window as Window & { __chapterDebug?: unknown }).__chapterDebug), 'undefined');
  await page.goto(`${BASE_URL}/read?debug=1&qaDay=2026-09-01`);
  await page.getByText('Welcome, Mike. Your new story is ready.').waitFor();
  await page.screenshot({ path: '/tmp/little-chapters-neutral-welcome.png', fullPage: true });
  await page.goto(`${BASE_URL}/read?debug=1&skipWelcome=1&qaDay=2026-09-01`);
  await page.waitForFunction(() => typeof (window as Window & { __chapterDebug?: unknown }).__chapterDebug === 'function');
  await page.waitForFunction(() => document.querySelector('.lc-runtime-debug-badge')?.textContent?.includes('Story: FALLBACK'));
  const result = await page.evaluate(() => ({
    build: (window as unknown as { __littleChaptersBuild: unknown }).__littleChaptersBuild,
    debug: (window as unknown as { __chapterDebug: () => any }).__chapterDebug(),
    badge: document.querySelector('.lc-runtime-debug-badge')?.textContent,
  }));
  assert.ok(result.build);
  assert.ok(result.debug.build.commitSha);
  assert.equal(result.debug.chapter.storySource, 'fallback');
  assert.equal(result.debug.chapter.generationStatus, 'fallback');
  assert.equal(result.debug.chapter.generationFailureReason, 'story-lookup-503');
  assert.equal(result.debug.visuals.scenePackageStatus, 'fallback');
  assert.equal(result.debug.environment.openAIConfigured, true);
  assert.match(result.badge ?? '', /Visuals: STATIC FALLBACK/);
  assert.equal(JSON.stringify(result.debug).includes('debug-child'), false);
  assert.ok(chapterRequests.some((entry) => entry.includes('dogs-mike-2026-09-01')), 'debug QA day reaches isolated chapter identity');
  await page.screenshot({ path: '/tmp/little-chapters-runtime-debug.png', fullPage: true });
  await browser.close();
  console.log('Live runtime diagnostics browser passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
