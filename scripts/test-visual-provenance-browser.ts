import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
const sandboxChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const svg = (color:string, label:string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="${color}"/><circle cx="400" cy="380" r="180" fill="white"/><text x="400" y="410" text-anchor="middle" font-size="54">${label}</text></svg>`)}`;

async function main() {
  const browser = await chromium.launch(existsSync(sandboxChromium) ? { executablePath:sandboxChromium } : {});
  const page = await browser.newPage({ viewport:{ width:900, height:800 } });
  await page.addInitScript(() => Object.defineProperty(window, 'speechSynthesis', { configurable:true, value:{
    speak(u:SpeechSynthesisUtterance){ setTimeout(() => u.onend?.({} as SpeechSynthesisEvent), 0); }, cancel(){}, pause(){}, resume(){}, getVoices(){return[];}, addEventListener(){}, removeEventListener(){}, dispatchEvent(){return true;},
  }}));
  const chapter = {
    id:'visual-hydration-fixture', title:"Today's Chapter", character:'Maya', companion:'Momo', setting:'a bright garden', ambience:'countryside',
    pages:[
      {text:'Maya found a little gate.',focusWords:['gate']},{text:'Momo pushed the gate open.',focusWords:['open']},
      {text:'A map lit up.',focusWords:['map']},{text:'They followed the map.',focusWords:['map']},{text:'They found a lost pup.',focusWords:['pup']},
    ], cliffhanger:['The pup wagged its tail.','Tomorrow…'], teaser:'A new path waits.', phonics:[{hint:'short words',words:['gate','map','pup']}], provenance:{source:'generated'},
  };
  await page.route('**/api/chapters/today', (route) => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({chapter})}));
  await page.route('**/api/chapters/story*', (route) => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({chapter})}));
  await page.route('**/api/chapters/visuals*', async (route, request) => {
    if (request.method() === 'GET') return route.fulfill({status:404,contentType:'application/json',body:'{}'});
    await new Promise((resolve) => setTimeout(resolve, 450));
    return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({cache:'miss',scenePackage:{
      chapterId:chapter.id, visualBibleVersion:2, provider:'fixture-generated', generatedAt:new Date().toISOString(), generationLatencyMs:450,
      scenes:['#d5f4e6','#fce1a8','#d9e8ff','#eadcff'].map((color,index)=>({sceneId:`scene-${index+1}`,assetUrl:svg(color,`GENERATED ${index+1}`),visualPurpose:'fixture',entities:[]})),
    }})});
  });
  await page.route('**/api/speech/**', (route) => route.fulfill({status:503,contentType:'application/json',body:'{}'}));
  await page.goto(BASE_URL);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('little-chapters-profile',JSON.stringify({childId:'visual-child',childName:'Maya',age:6,interests:['dogs','space','ocean'],createdAt:Date.now()})); });
  await page.goto(`${BASE_URL}/read?skipWelcome=1&sceneProgressionTest=1`);
  await page.waitForFunction(() => (window as any).__chapterDebug?.().chapterId === 'visual-hydration-fixture');
  const before = await page.evaluate(() => (window as any).__chapterDebug().scene);
  assert.equal(before.sceneSources['scene-1'], 'approved-static-fallback');
  await page.waitForFunction(() => {
    const debug = (window as any).__chapterDebug?.();
    return debug?.generatedPackageAvailable && debug.scene?.sceneSources?.['scene-1'] === 'generated'
      && debug.scene.renderedImgCurrentSrc === debug.scene.resolvedSceneUrl;
  });
  const after = await page.evaluate(() => (window as any).__chapterDebug());
  assert.equal(after.scene.sceneSources['scene-1'], 'generated');
  assert.match(after.scene.effectiveUrl ?? after.scene.resolvedSceneUrl, /^data:image\/svg/);
  assert.equal(after.scene.renderedImgCurrentSrc, after.scene.resolvedSceneUrl);
  assert.equal(after.scene.requestedSceneId, 'scene-1');
  await page.evaluate(() => (window as any).__sceneProgressionTestState({pageIdx:2}));
  await page.waitForFunction(() => (window as any).__chapterDebug().scene.requestedSceneId !== 'scene-1' && (window as any).__chapterDebug().scene.renderedImgCurrentSrc === (window as any).__chapterDebug().scene.resolvedSceneUrl);
  const next = await page.evaluate(() => (window as any).__chapterDebug().scene);
  assert.notEqual(next.renderedImgCurrentSrc, after.scene.renderedImgCurrentSrc);
  await browser.close();
  console.log('Visual provenance browser passed: delayed generated package displaced static fallback and followed requested scene IDs');
}
main().catch((error)=>{console.error(error);process.exit(1)});
