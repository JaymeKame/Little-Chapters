import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
const out = process.env.DAILY_ADVENTURE_SCREENSHOT_DIR ?? 'artifacts/daily-adventure';
async function main() {
await mkdir(out,{recursive:true});
const browser = await chromium.launch();
const viewports = [{w:768,h:1024,n:'ipad-portrait'},{w:1024,h:768,n:'ipad-landscape'},{w:390,h:844,n:'phone'},{w:1440,h:1000,n:'desktop'}];
const states = ['home-ready','reading','correction','sound-hunt','prediction','word-builder','story-unlock','ending'] as const;

for (const viewport of viewports) for (const state of states) {
  const page = await browser.newPage({viewport:{width:viewport.w,height:viewport.h}});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/api/chapters/**', (route) => route.fulfill({status:503,contentType:'application/json',body:'{"error":"capture fallback"}'}));
  await page.route('**/api/speech/**', (route) => route.fulfill({status:503,contentType:'application/json',body:'{"error":"capture muted"}'}));
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.evaluate(() => localStorage.setItem('little-chapters-profile',JSON.stringify({childId:'daily-capture',childName:'Ari',age:6,interests:['ocean'],avatar:'girl',createdAt:Date.now()})));
  if (state === 'home-ready') {
    await page.goto(`${base}/home?homeState=ready`,{waitUntil:'domcontentloaded'}); await page.locator('[data-home-state="ready"]').waitFor();
  } else {
    const adventureState = state === 'sound-hunt' || state === 'prediction' || state === 'word-builder' || state === 'correction' || state === 'story-unlock' || state === 'ending' ? `&adventureState=${state}` : '';
    await page.goto(`${base}/read?skipWelcome=1${adventureState}`,{waitUntil:'domcontentloaded'});
    const selector = state === 'sound-hunt' || state === 'prediction' || state === 'word-builder' || state === 'ending' ? `[data-session-beat="${state}"]` : '.lc-reading-scene';
    await page.locator(selector).waitFor({timeout:20000});
  }
  const responsive = await page.evaluate(() => {
    const controls = [...document.querySelectorAll<HTMLElement>('button')].filter((item) => item.offsetParent !== null);
    return {
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      clippedControls: controls.filter((item) => { const box=item.getBoundingClientRect(); return box.left < -1 || box.right > innerWidth + 1 || box.top < -1 || box.bottom > innerHeight + 1; }).length,
      undersizedControls: controls.filter((item) => { const box=item.getBoundingClientRect(); return box.width < 44 || box.height < 44; }).length,
    };
  });
  if (responsive.horizontalOverflow || responsive.clippedControls || responsive.undersizedControls) throw new Error(`${viewport.n}/${state} failed responsive acceptance: ${JSON.stringify(responsive)}`);
  await page.screenshot({path:`${out}/${viewport.n}-${state}.png`,animations:'disabled'});
  await page.close();
}
await browser.close();
console.log(`Daily Adventure responsive capture: ${viewports.length * states.length} screenshots`);
}
void main();
