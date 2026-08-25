import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
const out = process.env.DAILY_ADVENTURE_SCREENSHOT_DIR ?? 'artifacts/daily-adventure';
async function main() {
await mkdir(out,{recursive:true});
// The remote sandbox pre-installs Chromium at /opt/pw-browsers/chromium-1194
// (see /opt/pw-browsers). Playwright's own postinstall would try to fetch a
// version-mismatched build and fail — point directly at the pre-installed
// executable when it exists so this script runs locally AND in the sandbox.
const { existsSync } = await import('node:fs');
const sandboxChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(sandboxChromium) ? { executablePath: sandboxChromium } : {});
const viewports = [{w:768,h:1024,n:'ipad-768x1024',primary:true},{w:820,h:1180,n:'ipad-820x1180',primary:true},{w:1024,h:768,n:'ipad-1024x768',primary:true},{w:1180,h:820,n:'ipad-1180x820',primary:true},{w:390,h:844,n:'iphone-390x844',primary:false},{w:430,h:932,n:'iphone-430x932',primary:false},{w:1440,h:1000,n:'desktop-1440x1000',primary:false}];
const primaryStates = ['reading-tracker','correction','sound-hunt','prediction','word-builder','find-in-scene','story-unlock','ending'] as const;
const secondaryStates = ['reading-tracker','find-in-scene','ending'] as const;
let captures = 0;

for (const viewport of viewports) for (const state of (viewport.primary ? primaryStates : secondaryStates).filter((candidate) => !process.env.CAPTURE_STATE || candidate === process.env.CAPTURE_STATE)) {
  const page = await browser.newPage({viewport:{width:viewport.w,height:viewport.h}});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/api/chapters/**', (route) => route.fulfill({status:503,contentType:'application/json',body:'{"error":"capture fallback"}'}));
  await page.route('**/api/speech/**', (route) => route.fulfill({status:503,contentType:'application/json',body:'{"error":"capture muted"}'}));
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.evaluate(() => localStorage.setItem('little-chapters-profile',JSON.stringify({childId:'daily-capture',childName:'Ari',age:6,interests:['ocean'],avatar:'girl',createdAt:Date.now()})));
  const adventureState = state !== 'reading-tracker' ? `&adventureState=${state}` : '';
  await page.goto(`${base}/read?skipWelcome=1${adventureState}`,{waitUntil:'domcontentloaded'});
  const selector = state === 'sound-hunt' || state === 'prediction' || state === 'word-builder' || state === 'find-in-scene' || state === 'ending' ? `[data-session-beat="${state}"]` : '.lc-reading-scene';
  await page.locator(selector).waitFor({timeout:20000});
  if (state === 'reading-tracker') { await page.getByRole('button',{name:'sim: live'}).click(); await page.waitForTimeout(900); }
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
  captures += 1;
  await page.close();
}
await browser.close();
console.log(`Daily Adventure responsive capture: ${captures} screenshots`);
}
void main();
