import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
const out = process.env.WAVE2_SCREENSHOT_DIR ?? '/tmp/little-chapters-wave2';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
let passed = 0;

async function seededPage(width: number, height: number) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base);
  await page.evaluate(() => {
    localStorage.setItem('little-chapters-profile', JSON.stringify({ childId:'wave2-child', childName:'Sam', age:6, interests:['dogs','space','ocean'], avatar:'girl', createdAt:Date.now() }));
    localStorage.setItem('little-chapters-preferences', JSON.stringify({ music:'normal', communication:'in-app', difficultyObservation:'about-right', phoneNumber:'' }));
  });
  return page;
}

async function captureHome(state: 'loading'|'ready'|'continue'|'completed'|'locked'|'offline', width: number, height: number, label: string) {
  const page = await seededPage(width, height);
  await page.goto(`${base}/home?homeState=${state}`);
  await page.waitForSelector(`[data-home-state="${state}"]`);
  if (state !== 'loading') {
    const expected = state === 'ready' ? 'Play' : state === 'continue' ? 'Continue' : state === 'completed' ? 'Read again' : state === 'locked' ? 'Ask a grown-up' : 'Try again';
    if (!(await page.getByRole('button', { name: new RegExp(expected, 'i') }).count())) throw new Error(`${state} has no ${expected} action`);
  }
  await page.screenshot({ path:`${out}/home-${state}-${label}.png`, animations:'disabled' });
  await page.close();
  passed += 1;
}

for (const state of ['loading','ready','continue','completed','locked','offline'] as const) await captureHome(state, 390, 844, '390x844');

const mobileSettings = await seededPage(390, 844);
await mobileSettings.goto(`${base}/settings`);
await mobileSettings.getByRole('heading', { name:'Settings' }).waitFor();
await mobileSettings.getByRole('button', { name:'Low' }).click();
await mobileSettings.getByRole('button', { name:'Save settings' }).click();
const storedMusic = await mobileSettings.evaluate(() => JSON.parse(localStorage.getItem('little-chapters-preferences') ?? '{}').music);
if (storedMusic !== 'low') throw new Error('music preference was not persisted');
await mobileSettings.screenshot({ path:`${out}/settings-390x844.png`, fullPage:true, animations:'disabled' });
await mobileSettings.close();
passed += 1;

for (const state of ['loading','ready','continue','completed','locked','offline'] as const) await captureHome(state, 1440, 1000, 'desktop');
const desktopSettings = await seededPage(1440, 1000);
await desktopSettings.goto(`${base}/settings`);
await desktopSettings.getByRole('heading', { name:'Settings' }).waitFor();
await desktopSettings.screenshot({ path:`${out}/settings-desktop.png`, fullPage:true, animations:'disabled' });
await desktopSettings.close();
passed += 1;

await browser.close();
console.log(`V1.1 browser: ${passed} passed, 0 failed; screenshots: ${out}`);
