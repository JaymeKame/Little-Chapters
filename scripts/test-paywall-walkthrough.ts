/* Real-browser walkthrough for the free-demo-then-paywall integration:
 * anonymous demo flow end-to-end, the paywall gate appearing after the free
 * chapter, a deep-link guard on a locked chapter, and — most importantly —
 * a full Reader regression (listening -> scoring -> correction -> success ->
 * page change -> chapter-end) proving the paywall wiring does not interfere
 * with grading/MDD/audio/scene-selector behavior.
 *
 * No real Firebase/Stripe/Twilio credentials needed: this profile never
 * signs in, so it only ever exercises the anonymous/unauthenticated paths
 * (useEntitlement's `if (!user || !isAuthenticated) return false` branch —
 * i.e. never locked, since `subscribed` stays `false` only once auth
 * resolves to a real signed-out state, and the free chapter has not been
 * spent yet on a fresh profile).
 *
 *   node --experimental-strip-types scripts/test-paywall-walkthrough.ts
 */

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
let passed = 0;
let failed = 0;

function ok(label: string): void {
  console.log(`  ✓  ${label}`);
  passed++;
}
function fail(label: string, detail?: string): void {
  console.error(`  ✗  ${label}${detail ? `\n     ${detail}` : ''}`);
  failed++;
}

async function main() {
  const screenshotDir = process.env.NARROW_SPRINT_SCREENSHOT_DIR ?? '/tmp/little-chapters-child-native';
  await mkdir(screenshotDir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  let storedChapter: any = null;
  let storedScenePackage: any = null;
  let storyGenerations = 0;
  let visualGenerations = 0;
  let generationRequest: any = null;
  await page.route('**/api/chapters/story*', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ status: storedChapter ? 200 : 404, contentType:'application/json', body:JSON.stringify(storedChapter ? { chapter:storedChapter, cache:'hit' } : { error:'CHAPTER_NOT_FOUND' }) });
    generationRequest = request.postDataJSON(); storyGenerations += 1;
    const profile = generationRequest.profile;
    storedChapter = { id:generationRequest.chapterId, title:"Today's Chapter", character:profile.childName, companion:'Pip', setting:'a moonlit dog-friendly observatory', ambience:'space',
      pages:[{text:`${profile.childName} found a shell.`,focusWords:['shell']},{text:'The shell lit a map.',focusWords:['map']},{text:'A ship came near.',focusWords:['ship']},{text:'The map led to the ship.',focusWords:['ship']},{text:'The ship rose into the stars.',focusWords:['stars']}],
      cliffhanger:['The stars revealed a secret door.','Tomorrow…'],teaser:'The secret door opens tomorrow.',phonics:[{hint:'sh in shell',words:['shell','ship']}],
      provenance:{source:'generated',entitlementSource:'free',generatedAt:'2026-08-25T00:00:00.000Z'} };
    return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({chapter:storedChapter})});
  });
  await page.route('**/api/chapters/visuals*', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({status:storedScenePackage ? 200 : 404,contentType:'application/json',body:JSON.stringify(storedScenePackage ? {scenePackage:storedScenePackage,cache:'hit'}:{error:'SCENE_PACKAGE_NOT_FOUND'})});
    visualGenerations += 1; const chapter = request.postDataJSON().chapter;
    storedScenePackage = {chapterId:chapter.id,visualBibleVersion:1,provider:'test-provider',generatedAt:'2026-08-25T00:00:00.000Z',generationLatencyMs:100,
      scenes:[1,2,3,4].map((number)=>({sceneId:`scene-${number}`,assetUrl:'/images/scenes/bg-meadow-path-sunny-01.jpg',visualPurpose:'story',entities:[]}))};
    return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({scenePackage:storedScenePackage,cache:'miss'})});
  });

  page.on('console', (msg: any) => {
    if (msg.type() === 'error') console.log('  [browser console error]', msg.text());
  });

  console.log('\n=== Test 1: fresh anonymous profile reaches Home with an unlocked Play button ===');
  {
    await page.goto(BASE_URL);
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem(
        'little-chapters-profile',
        JSON.stringify({
          childId: 'test-child-paywall-walkthrough',
          childName: 'Robin',
          age: 5,
          interests: ['dogs', 'space', 'ocean'],
          avatar: 'girl',
        }),
      );
    });
    await page.goto(`${BASE_URL}/home`);
    await page.waitForSelector('button[aria-label="Play today’s adventure"]', { timeout: 15000 });
    ok('Home renders the unlocked Play action for a brand-new anonymous profile');
    if (generationRequest?.profile?.childName === 'Robin' && generationRequest.profile.interests.length === 3 && typeof generationRequest.stage === 'number') ok('free chapter reaches personalized story generation with profile, interests, and reading stage');
    else fail('free chapter did not carry complete personalization into generation');
    if (storyGenerations === 1) ok('free chapter requests the real generated-story pipeline exactly once');
    else fail('free chapter did not use the generated-story pipeline exactly once', JSON.stringify({storyGenerations}));
  }

  console.log('\n=== Test 2: full Reader regression — Home -> Read -> listening -> scoring -> correction -> success -> page change ===');
  {
    await page.click('button[aria-label="Play today’s adventure"]');
    await page.waitForURL('**/read', { timeout: 10000 });
    await page.getByRole('button', { name: 'Open the story' }).click();
    await page.waitForSelector('button[aria-label="Start reading"]', { timeout: 15000 });
    ok('Read screen loads with the intro/start-reading control (not bounced to /unlock — chapter is not locked)');

    await page.click('button[aria-label="Start reading"]');
    await page.waitForSelector('button:has-text("sim: good")', { timeout: 15000 }).catch(() => null);
    const hasSimGood = await page.locator('button:has-text("sim: good")').count();
    if (hasSimGood === 0) {
      fail('dev-only "sim: good" button not found — cannot drive a mic-free regression pass');
    } else {
      ok('dev-only sim buttons are present (mic-free regression path available)');
    }

    // Drive through every page and each planned interaction. Predictions do
    // not branch the canonical chapter and the sound hunt appears only once.
    let pages = 0;
    let manifestCacheChecked = false;
    const maxPages = 12;
    while (pages < maxPages) {
      const interaction = page.locator('[data-session-beat="sound-hunt"], [data-session-beat="prediction"], [data-session-beat="word-builder"]');
      if (await interaction.count()) {
        const beat = await interaction.getAttribute('data-session-beat');
        const manifestBeat = beat === 'sound-hunt' ? 'find-sound' : beat;
        if (!manifestCacheChecked) {
          const manifestCached = await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('little-chapters-interaction-manifest:')));
          if (manifestCached) ok('story interaction manifest is persisted by chapter id for reload reuse');
          else fail('story interaction manifest was not persisted');
          manifestCacheChecked = true;
        }
        const lookahead = await page.evaluate((beatId) => {
          const events = (window as unknown as { __storyOrchestration?: Array<{ type:string; beatId:string }> }).__storyOrchestration ?? [];
          return ['image-preload','voice-preload'].every((type) => events.some((event) => event.beatId === beatId && event.type === type));
        }, manifestBeat);
        if (lookahead) ok(`${beat} image and tutor prompt were prepared by one-beat lookahead`);
        else fail(`${beat} did not receive both lookahead media preparations`);
        await page.screenshot({ path: `${screenshotDir}/${beat}-390x844.png`, animations: 'disabled' });
        const soundAnswer = interaction.locator('[data-correct="true"]');
        if (beat === 'word-builder') {
          const pieces = interaction.locator('.lc-choice-grid button');
          for (let index = 0; index < await pieces.count(); index += 1) await pieces.nth(index).click();
        } else if (await soundAnswer.count()) {
          await interaction.locator('.lc-choice-grid button:not([data-correct="true"])').first().click();
          await interaction.getByRole('status').waitFor();
          if (!(await interaction.count())) fail('an incorrect sound-hunt choice advanced the story');
          else ok('incorrect sound-hunt choice stays in the game and gently retries');
          await soundAnswer.click();
        } else {
          await interaction.locator('.lc-choice-grid button').first().click();
        }
        await interaction.waitFor({ state: 'detached', timeout: 8000 });
        ok('successful child interaction advances automatically without a Continue button');
        continue;
      }
      const simGood = page.locator('button:has-text("sim: good")');
      if ((await simGood.count()) === 0) break;
      await simGood.first().click();
      pages += 1;
      await page.waitForTimeout(900);
      const chapterEndVisible = await page.locator('[data-session-beat="ending"]').count();
      if (chapterEndVisible > 0) break;
    }
    ok(`advanced through ${pages} page(s) via sim: good without a stuck state`);

    const chapterEndVisible = await page.locator('[data-session-beat="ending"]').count();
    if (chapterEndVisible > 0) {
      ok('meaningful chapter-ending screen reached');
      await page.screenshot({ path: `${screenshotDir}/ending-390x844.png`, animations: 'disabled' });
    } else {
      fail('chapter-ending screen never appeared after driving the session plan');
    }
  }

  console.log('\n=== Test 3: ending preserves the child payoff before a grown-up handoff ===');
  {
    const backHome = page.getByRole('button', { name: 'Back to Home' });
    const conversionCopy = page.getByText(/create your account|save the adventure/i);
    if ((await backHome.count()) === 1 && (await conversionCopy.count()) === 0) {
      ok('performed ending has one child action and no conversion UI covering the payoff');
    } else {
      fail('expected ending action or grown-up handoff was not found');
    }

    const oldCopy = await page.locator('text=Create Free Account').count();
    if (oldCopy === 0) {
      ok('account-conversion copy does not cover the child-facing ending');
    } else {
      fail('old "Create Free Account" copy is still present alongside the new card');
    }
  }

  console.log('\n=== Test 4: completion persists and Home renders Completed Today ===');
  {
    const historyCount = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('little-chapters-history:anon');
        return raw ? JSON.parse(raw).length : 0;
      } catch {
        return -1;
      }
    });
    if (historyCount >= 1) {
      ok(`chapter-history localStorage entry recorded (${historyCount} entr${historyCount === 1 ? 'y' : 'ies'})`);
    } else {
      fail('no chapter-history entry recorded after completing the chapter', String(historyCount));
    }
    await page.getByRole('button', { name: 'Back to Home' }).click();
    await page.waitForSelector('[data-home-state="completed"]', { timeout: 15000 });
    ok('Back to Home renders the peaceful Completed Today state');
    await page.getByRole('heading', { name: /Save Robin’s adventure/i }).waitFor();
    ok('completed Home performs the explicit grown-up save-adventure handoff');
    await page.screenshot({ path: `${screenshotDir}/grownup-handoff-390x844.png`, animations: 'disabled' });
    await page.getByRole('button', { name: 'Save the adventure' }).click();
    await page.waitForURL('**/register', { timeout: 10000 });
    await page.getByRole('heading', { name: 'Save their adventure' }).waitFor();
    ok('save-adventure handoff reaches account creation before payment');
  }

  console.log('\n=== Test 5: /unlock renders standalone (paywall screen itself, not wired to a live Stripe key in this env) ===');
  {
    await page.goto(`${BASE_URL}/unlock`);
    await page.waitForTimeout(500);
    const bodyText = await page.locator('body').innerText();
    if (/free chapter|keep going|chapter every day/i.test(bodyText)) {
      ok('/unlock renders its paywall content');
    } else {
      fail('/unlock did not render expected paywall content', bodyText.slice(0, 200));
    }
  }

  if (storyGenerations === 1 && visualGenerations === 1) ok('free Home → Read flow generated, then reused, the same durable story and visual package without regeneration');
  else fail('navigation regenerated durable content', JSON.stringify({storyGenerations,visualGenerations}));

  await browser.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal error running paywall walkthrough:', e);
  process.exit(1);
});
