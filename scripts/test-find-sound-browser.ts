import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
const sandboxChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const chapter = {
  id: 'find-sound-browser-fixture', title: "Today's Chapter", character: 'Robin', companion: 'Pip', setting: 'a moonlit observatory', ambience: 'space',
  pages: [
    { text: 'Robin found a shell.', focusWords: ['shell'] }, { text: 'The shell lit a map.', focusWords: ['map'] },
    { text: 'A ship came near.', focusWords: ['ship'] }, { text: 'The map led to the ship.', focusWords: ['ship'] },
    { text: 'The ship rose into the stars.', focusWords: ['stars'] },
  ],
  cliffhanger: ['The stars revealed a secret door.', 'Tomorrow…'], teaser: 'The secret door opens tomorrow.',
  phonics: [{ hint: 'sh in shell', words: ['shell', 'ship'] }], provenance: { source: 'generated', entitlementSource: 'free' },
};

async function openGame(browser: Browser, completeSpeech: boolean): Promise<{ page: Page; spoken: string[] }> {
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  const spoken: string[] = [];
  await page.addInitScript((complete) => {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      speak(utterance: SpeechSynthesisUtterance) { if (complete) window.setTimeout(() => utterance.onend?.({} as SpeechSynthesisEvent), 250); },
      cancel() {}, pause() {}, resume() {}, getVoices() { return []; }, speaking: false, pending: false, paused: false,
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    } });
  }, completeSpeech);
  await page.route('**/api/chapters/today', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chapter }) }));
  await page.route('**/api/chapters/story*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chapter }) }));
  await page.route('**/api/chapters/visuals*', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"fixture uses approved fallback"}' }));
  await page.route('**/api/speech/model', async (route) => {
    const body = route.request().postDataJSON() as { text?: string };
    if (body.text) spoken.push(body.text.toLowerCase());
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"use browser speech fixture"}' });
  });
  await page.goto(BASE_URL);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('little-chapters-profile', JSON.stringify({ childId: 'find-sound-test', childName: 'Robin', age: 6, interests: ['space'], avatar: 'girl', createdAt: Date.now() }));
  });
  await page.goto(`${BASE_URL}/read?skipWelcome=1&disableLookahead=1&sceneProgressionTest=1`);
  await page.getByRole('button', { name: 'sim: good' }).waitFor();
  await page.waitForFunction((chapterId) => (window as any).__chapterDebug().chapterId === chapterId, chapter.id);
  await page.waitForTimeout(100);
  spoken.length = 0;
  await page.evaluate(() => (window as any).__sceneProgressionTestState({ pageIdx: 0, beatId: 'find-sound' }));
  await page.locator('[data-session-beat="sound-hunt"]').waitFor();
  return { page, spoken };
}

async function main() {
  const browser = await chromium.launch(existsSync(sandboxChromium) ? { executablePath: sandboxChromium } : {});
  const normal = await openGame(browser, true);
  const game = normal.page.locator('[data-session-beat="sound-hunt"]');
  await normal.page.waitForFunction(() => document.querySelector('[data-session-beat="sound-hunt"]')?.getAttribute('data-interaction-ready') === 'true');
  assert.equal(normal.spoken.length, 1, 'one semantic tutor turn makes one TTS request');
  assert.equal(normal.spoken[0].replace(/\s+/g, ' ').trim(),
    'listen to these words. ship... shoe... shut... listen to how they begin. which story word starts the same way?');
  assert.ok(!normal.spoken.some((text) => /\/(sh|th|ch)\//.test(text)), 'automatic model never sends slash notation to speech');
  assert.equal(await normal.page.locator('.lc-prompt-speaker').getAttribute('aria-label'), 'Hear the example words again');

  const wrong = game.locator('.lc-choice-grid button:not([data-correct="true"])').first();
  const wrongLabel = await wrong.getAttribute('aria-label');
  await wrong.click();
  await normal.page.waitForFunction(() => document.querySelector('[data-session-beat="sound-hunt"] .lc-choice-grid button.is-try-again'));
  assert.ok((await wrong.getAttribute('class'))?.includes('is-try-again'), 'wrong tap receives immediate visible feedback');
  assert.equal(await wrong.isDisabled(), true, 'choices become visibly inert during correction');
  await normal.page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[data-session-beat="sound-hunt"] .lc-choice-grid button')?.disabled, null, { timeout: 15000 });
  const correctionSpeech = normal.spoken.join(' | ');
  assert.match(correctionSpeech, new RegExp(`that's ${wrongLabel}`, 'i'));
  assert.match(correctionSpeech, /listen again/);
  assert.match(correctionSpeech, /ship/);
  assert.match(correctionSpeech, /shell/);
  assert.match(correctionSpeech, /start the same/);

  const correct = game.locator('[data-correct="true"]');
  await correct.click();
  assert.ok((await correct.getAttribute('class'))?.includes('is-success'), 'correct tap receives immediate visible success');
  await game.waitFor({ state: 'detached', timeout: 15000 });
  const successSpeech = normal.spoken.join(' | ');
  assert.match(successSpeech, /yes.*shell/);
  assert.match(successSpeech, /shell starts with shhhh/);
  assert.match(successSpeech, /shhhh.*shell/);
  assert.equal((await normal.page.evaluate(() => (window as any).__chapterDebug().scene.pageIdx)), 1, 'success advances the story');
  await normal.page.close();

  const missingCompletion = await openGame(browser, false);
  const blockedChoice = missingCompletion.page.locator('[data-session-beat="sound-hunt"] .lc-choice-grid button').first();
  assert.equal(await blockedChoice.isDisabled(), true, 'choices are visibly disabled while the model is unresolved');
  await missingCompletion.page.waitForFunction(() => document.querySelector('[data-session-beat="sound-hunt"]')?.getAttribute('data-interaction-ready') === 'true', null, { timeout: 30000 });
  assert.equal(await blockedChoice.isEnabled(), true, 'bounded watchdog recovers when speech never calls onEnd');
  await missingCompletion.page.evaluate(() => (window as any).__sceneProgressionTestState({ pageIdx: 0, beatId: 'find-in-scene' }));
  const tactile = missingCompletion.page.locator('[data-session-beat="find-in-scene"]');
  await tactile.waitFor();
  assert.equal(await tactile.getAttribute('data-interaction-mode'), 'tactile-card-fallback', 'static fallback never makes an unverified spatial-object claim');
  assert.equal(await tactile.locator('.lc-scene-hotspot').count(), 0, 'no hotspot is rendered without the matching loaded generated scene');
  await missingCompletion.page.close();

  await browser.close();
  console.log('Find the Sound browser contract: automatic model, retry, success, and watchdog passed');
}

void main();
