import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium, type Page } from 'playwright';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
const sandboxChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

async function openSlider(page: Page) {
  await page.addInitScript(() => Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    speak(utterance: SpeechSynthesisUtterance) { window.setTimeout(() => utterance.onend?.({} as SpeechSynthesisEvent), 90); },
    cancel() {}, pause() {}, resume() {}, getVoices() { return []; }, speaking: false, pending: false, paused: false,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  } }));
  await page.route('**/api/speech/model', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"use deterministic browser speech"}' }));
  await page.route('**/api/chapters/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.goto(BASE_URL);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('little-chapters-profile', JSON.stringify({ childId:'scroll-child', childName:'Maya', age:6, interests:['dogs','space','ocean'], createdAt:Date.now() }));
  });
  await page.goto(`${BASE_URL}/read?skipWelcome=1&slideDemo=ship`);
  await page.locator('input[type=range]').waitFor();
}

async function move(page: Page, values: number[], pauseMs = 0) {
  for (const value of values) {
    await page.locator('input[type=range]').evaluate((node, next) => {
      const input = node as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, String(next)); input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
    if (pauseMs) await page.waitForTimeout(pauseMs);
  }
}

async function main() {
const browser = await chromium.launch(existsSync(sandboxChromium) ? { executablePath: sandboxChromium } : {});
for (const test of [{ name:'ultra-fast', pause:0 }, { name:'normal', pause:180 }]) {
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  await openSlider(page);
  await page.evaluate(() => {
    (window as any).__wordScrollStates = [0];
    const node = document.querySelector('.lc-slide-help')!;
    new MutationObserver(() => {
      const value = Number(node.getAttribute('data-chunk-index'));
      const states = (window as any).__wordScrollStates as number[];
      if (states.at(-1) !== value) states.push(value);
    }).observe(node, { attributes:true, attributeFilter:['data-chunk-index'] });
  });
  const max = Number(await page.locator('input[type=range]').getAttribute('max'));
  const values = Array.from({ length:max }, (_, index) => index + 1);
  await move(page, values, test.pause);
  await page.waitForFunction(() => document.querySelector('.lc-slide-help')?.getAttribute('data-word-scroll-state') === 'retry-ready');
  const observed = await page.evaluate(() => (window as any).__wordScrollStates as number[]);
  const state = await page.locator('.lc-slide-help').getAttribute('data-word-scroll-state');
  const count = await page.locator('.lc-slide-help').getAttribute('data-full-word-model-count');
  assert.equal(state, 'retry-ready');
  assert.equal(count, '1');
  assert.deepEqual(observed.filter((value) => value > 0), values, `${test.name}: chunk states stay ordered`);
  assert.equal(await page.locator('.lc-slide-caption').textContent(), 'Now it’s your turn.');
  assert.ok(await page.getByRole('button', { name:'Try the word', exact:true }).isEnabled(), `${test.name}: retry unlocks`);
  if (test.name === 'ultra-fast') await page.screenshot({ path:'/tmp/little-chapters-word-scroll-complete.png', fullPage:true });
  await page.close();
}
await browser.close();
console.log('Word-scroll browser passed: ultra-fast and normal traversal settle, model once, and unlock retry');
}

main().catch((error) => { console.error(error); process.exit(1); });
