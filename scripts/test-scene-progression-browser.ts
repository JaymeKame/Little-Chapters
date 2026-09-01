import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium, type Page } from 'playwright';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
const sandboxChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
interface SceneSnapshot {
  pageIdx: number;
  activeInteractionId: string | null;
  activeInteractionVisualSceneId: string | null;
  pageAuthoredSceneId: string;
  requestedSceneId: string;
  resolvedSceneUrl: string;
  renderedImgSrc: string;
  renderedImgCurrentSrc: string;
  hash: string;
}

async function snapshot(page: Page): Promise<SceneSnapshot> {
  await page.locator('.lc-scene-bg img').waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>('.lc-scene-bg img');
    return Boolean(image?.complete && image.naturalWidth > 0 && image.currentSrc);
  });
  return page.evaluate(async () => {
    const debug = (window as typeof window & { __chapterDebug: () => { scene: Omit<SceneSnapshot, 'hash'> } }).__chapterDebug().scene;
    const response = await fetch(debug.renderedImgCurrentSrc);
    const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
    return { ...debug, hash: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('') };
  });
}

async function main() {
  const browser = await chromium.launch(existsSync(sandboxChromium) ? { executablePath: sandboxChromium } : {});
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      speak(utterance: SpeechSynthesisUtterance) { window.setTimeout(() => utterance.onend?.({} as SpeechSynthesisEvent), 0); },
      cancel() {}, pause() {}, resume() {}, getVoices() { return []; }, speaking: false, pending: false, paused: false,
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    } });
  });
  const chapter = {
    id: 'scene-progression-browser-fixture', title: "Today's Chapter", character: 'Robin', companion: 'Pip',
    setting: 'a moonlit observatory', ambience: 'space',
    pages: [
      { text: 'Robin found a shell.', focusWords: ['shell'] },
      { text: 'The shell lit a map.', focusWords: ['map'] },
      { text: 'A ship came near.', focusWords: ['ship'] },
      { text: 'The map led to the ship.', focusWords: ['ship'] },
      { text: 'The ship rose into the stars.', focusWords: ['stars'] },
    ],
    cliffhanger: ['The stars revealed a secret door.', 'Tomorrow…'], teaser: 'The secret door opens tomorrow.',
    phonics: [{ hint: 'sh in shell', words: ['shell', 'ship'] }],
    provenance: { source: 'generated', entitlementSource: 'free', generatedAt: '2026-08-25T00:00:00.000Z' },
  };
  await page.route('**/api/chapters/today', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chapter }) }));
  await page.route('**/api/chapters/story*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ chapter }) }));
  await page.route('**/api/chapters/visuals*', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"fixture verifies approved static fallback"}' }));
  await page.route('**/api/speech/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"muted fixture"}' }));

  await page.goto(BASE_URL);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('little-chapters-profile', JSON.stringify({ childId: 'scene-progression-test', childName: 'Robin', age: 6, interests: ['space'], avatar: 'girl', createdAt: Date.now() }));
  });
  await page.goto(`${BASE_URL}/read?skipWelcome=1&disableLookahead=1&sceneProgressionTest=1`);
  await page.getByRole('button', { name: 'sim: good' }).waitFor();

  const states: SceneSnapshot[] = [await snapshot(page)];
  for (const next of [
    { pageIdx: 2 },
    { pageIdx: 0, beatId: 'find-in-scene' },
    { pageIdx: 3 },
    { pageIdx: 0, beatId: 'prediction' },
    { pageIdx: 4 },
  ]) {
    await page.evaluate((state) => (window as any).__sceneProgressionTestState(state), next);
    await page.waitForFunction((state) => {
      const scene = (window as any).__chapterDebug().scene;
      return scene.pageIdx === state.pageIdx && scene.activeInteractionId === (state.beatId ? (state.beatId === 'find-in-scene' ? 'find-in-scene' : state.beatId) : null);
    }, next);
    states.push(await snapshot(page));
  }

  const interactionStates = states.filter((state) => state.activeInteractionId);
  for (const state of interactionStates) assert.equal(state.requestedSceneId, state.activeInteractionVisualSceneId, 'active interaction must request its story-authored scene');
  const overrides = interactionStates.filter((state) => state.requestedSceneId !== state.pageAuthoredSceneId);
  assert.ok(overrides.length >= 1, 'sequential fixture must exercise at least one authored interaction override');
  for (const state of overrides) assert.equal(state.renderedImgSrc, state.resolvedSceneUrl, 'interaction-authored URL must own the background');
  const readingStates = states.filter((state) => !state.activeInteractionId);
  const byPage = new Map(readingStates.map((state) => [state.pageIdx, state]));
  assert.equal(byPage.get(0)?.requestedSceneId, 'scene-1');
  assert.equal(byPage.get(2)?.requestedSceneId, 'scene-2');
  assert.notEqual(byPage.get(0)?.renderedImgCurrentSrc, byPage.get(2)?.renderedImgCurrentSrc, 'actual currentSrc must progress between authored reading scenes');
  assert.notEqual(byPage.get(0)?.hash, byPage.get(2)?.hash, 'rendered bytes must progress between authored reading scenes');
  const sources = await page.evaluate(() => (window as any).__chapterDebug().scene.sceneSources);
  assert.ok(Object.values(sources).every((source) => source === 'approved-static-fallback'));
  assert.equal(new Set(Object.values(await page.evaluate(() => (window as any).__chapterDebug().scene.sceneAssetUrls))).size, 4, 'fallback session must not collapse to one wallpaper');
  console.log(`Scene progression browser regression: ${states.length} sequential states passed without reload`);
  await browser.close();
}

void main();
