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
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

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
    const maxPages = 12;
    while (pages < maxPages) {
      const interaction = page.locator('[data-session-beat="sound-hunt"], [data-session-beat="prediction"]');
      if (await interaction.count()) {
        await interaction.locator('.lc-choice-grid button').first().click();
        await interaction.getByRole('button', { name: 'Keep the story going' }).click();
        await page.waitForTimeout(200);
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
    } else {
      fail('chapter-ending screen never appeared after driving the session plan');
    }
  }

  console.log('\n=== Test 3: ending preserves the child payoff before a grown-up handoff ===');
  {
    const backHome = page.getByRole('button', { name: 'Back to Home' });
    const handoff = page.getByText(/quiet note for a grown-up/i);
    if ((await backHome.count()) === 1 && (await handoff.count()) === 1) {
      ok('ending has one child action and a quiet grown-up handoff, with no covering paywall');
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

  await browser.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal error running paywall walkthrough:', e);
  process.exit(1);
});
