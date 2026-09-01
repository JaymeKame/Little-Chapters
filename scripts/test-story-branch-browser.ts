import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { chapterFor } from '../lib/chapters.ts';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
const fixture = { ...chapterFor('trains', 'Mike'), id: 'story-branch-browser-fixture', provenance: { source: 'generated' as const, entitlementSource: 'free' as const } };

async function runBranch(id: 'A' | 'B'): Promise<string> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  await page.addInitScript(() => Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    speak(utterance: SpeechSynthesisUtterance) { window.setTimeout(() => utterance.onend?.({} as SpeechSynthesisEvent), 0); },
    cancel() {}, pause() {}, resume() {}, getVoices() { return []; }, speaking: false, pending: false, paused: false,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  } }));
  await page.route('**/api/chapters/today', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chapter: fixture }) }));
  await page.route('**/api/chapters/story*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chapter: fixture }) }));
  await page.route('**/api/chapters/visuals*', (route) => route.fulfill({ status: 404, body: '{}' }));
  await page.route('**/api/speech/**', (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.goto(BASE_URL);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('little-chapters-profile', JSON.stringify({ childId: 'branch-child', childName: 'Mike', age: 7, interests: ['trains'], createdAt: Date.now() })); });
  await page.goto(`${BASE_URL}/read?skipWelcome=1&disableLookahead=1&sceneProgressionTest=1`);
  await page.getByRole('button', { name: 'sim: good' }).waitFor();
  await page.evaluate(() => (window as any).__sceneProgressionTestState({ pageIdx: 2, beatId: 'prediction' }));
  const option = page.locator('[data-session-beat="prediction"] .lc-choice-grid button').filter({ hasText: id === 'A' ? 'checks the nearest clue' : 'follows the winding path' });
  await option.click();
  await page.locator('[data-session-beat="prediction"]').waitFor({ state: 'detached' });
  const consequenceIndex = fixture.storyBlueprint!.prediction.afterPageIndex + 1;
  await page.evaluate((pageIdx) => (window as any).__sceneProgressionTestState({ pageIdx }), consequenceIndex);
  const text = (await page.locator('.lc-page-text').innerText()).replace(/\s+/g, ' ').trim();
  await browser.close();
  return text;
}

async function main() {
  const a = await runBranch('A');
  const b = await runBranch('B');
  assert.equal(a, fixture.storyBlueprint!.prediction.optionA.page.text);
  assert.equal(b, fixture.storyBlueprint!.prediction.optionB.page.text);
  assert.notEqual(a, b);
  console.log('Story branch browser contract passed: A and B select different pre-authored consequence pages');
}

void main();
