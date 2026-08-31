import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { chapterDebugEnabled } from '../lib/adventure-debug.ts';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
const sandboxChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const installedChromium = '/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';

async function main() {
  assert.equal(chapterDebugEnabled('', 'production'), false);
  assert.equal(chapterDebugEnabled('?debug=0', 'production'), false);
  assert.equal(chapterDebugEnabled('?debug=1', 'production'), true);
  const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, sandboxChromium, installedChromium]
    .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const page = await browser.newPage();
  await page.route('**/api/chapters/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.goto(BASE_URL);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('little-chapters-profile', JSON.stringify({ childId:'debug-child', childName:'Maya', age:6, interests:['dogs','space','ocean'], createdAt:Date.now() }));
  });

  await page.goto(`${BASE_URL}/home?debug=1`);
  await page.waitForFunction(() => typeof (window as Window & { __chapterDebug?: unknown }).__chapterDebug === 'function');
  const snapshot = await page.evaluate(() => (window as unknown as { __chapterDebug: () => unknown }).__chapterDebug());
  assert.ok(snapshot && typeof snapshot === 'object');

  await browser.close();
  console.log('Production diagnostics passed: production gate is hidden by default and browser enables ?debug=1');
}

main().catch((error) => { console.error(error); process.exit(1); });
