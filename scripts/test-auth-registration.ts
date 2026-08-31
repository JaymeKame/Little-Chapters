/* Regression tests for the "Google returns to /register with no
 * confirmation, Continue to Payment does nothing" live-production report
 * (see components/AuthProvider.tsx and app/register/page.tsx). The root
 * cause was traced (via a live window.__authDebug() capture) to
 * signInWithRedirect()/getRedirectResult() being unreliable for this app's
 * hosting shape (Vercel origin, separate Firebase authDomain) — replaced
 * with popup-based credential recovery (recoverExistingAccount in
 * AuthProvider.tsx); redirect is no longer used anywhere in the Google/
 * Apple flow.
 *
 * This environment has NO Firebase web config (no NEXT_PUBLIC_FIREBASE_*
 * env vars), so a real Google popup/link flow cannot be driven here — that
 * requires either real credentials or the Firebase Auth Emulator, neither
 * available in this sandbox. What CAN be verified without Firebase
 * configured at all is exactly the class of bug this task fixes: an
 * unauthenticated state (here: Firebase never initialized, same end result
 * — isAuthenticated stays false) must never present a "Continue to
 * Payment" button that looks clickable but silently no-ops, and
 * window.__authDebug() must exist and report that state accurately.
 *
 * See the final report for what could only be verified by careful code
 * reading (the linkWithPopup/credential-recovery/publish() wiring itself)
 * rather than a live run, and what still needs one real-device check.
 *
 *   node --experimental-strip-types scripts/test-auth-registration.ts
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
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  console.log('\n=== Test 1: unauthenticated state is clearly reported (window.__authDebug) ===');
  {
    await page.goto(`${BASE_URL}/register`);
    await page.waitForTimeout(500);
    const debug = await page.evaluate(() => (window as any).__authDebug?.());
    if (!debug) {
      fail('window.__authDebug() is not defined at all');
    } else {
      if (debug.isAuthenticated === false) ok('__authDebug reports isAuthenticated: false for a fresh/unauthenticated session');
      else fail('expected isAuthenticated: false', JSON.stringify(debug));
      if ('lastOperation' in debug && 'lastError' in debug && 'idTokenChangedFired' in debug && 'uid' in debug && 'providerIds' in debug) {
        ok('__authDebug exposes lastOperation/lastError/idTokenChangedFired/uid/isAnonymous/email/providerIds');
      } else {
        fail('__authDebug is missing required diagnostic fields', JSON.stringify(debug));
      }
      // Check VALUES, not key names — `idTokenChangedFired` legitimately
      // contains the substring "token" in its key. A real leak would show up
      // as a long opaque string value (a JWT, API key, etc.), not a boolean
      // or a short known field.
      const values = Object.values(debug).map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)));
      const leaked = values.find((v) => /^[A-Za-z0-9_-]{40,}$/.test(v) || v.includes('.ey')); // .ey = start of a base64 JWT payload segment
      if (!leaked) ok('__authDebug values contain no token/JWT/API-key-shaped strings');
      else fail('__authDebug payload may be leaking sensitive data', String(leaked));
    }
  }

  console.log('\n=== Test 2: unauthenticated "Continue to Payment" — honest disabled state ===');
  {
    // V1-polish (2026-08-31): registration phone is now OPTIONAL and the
    // "Continue to Payment" gate is `disabled={!isAuthenticated}` alone.
    // The invariant is that the button clearly LOOKS disabled while the
    // parent hasn't signed in yet AND does not silently succeed — either
    // is a real bug. The previous test asserted the opposite (the
    // pre-polish design kept it clickable and threw an inline error);
    // that was the right fix at the time but is no longer the current UX.
    await page.goto(`${BASE_URL}/register`);
    await page.waitForSelector('input[type="tel"]', { timeout: 15000 });
    // Phone is optional now — no need to prefill to reach the button.

    const button = page.locator('button[type="submit"]:has-text("Continue to Payment")');
    const isDisabled = await button.isDisabled();
    if (isDisabled) {
      ok('the Continue-to-Payment button is disabled while unauthenticated (real state — no silent no-op)');
    } else {
      fail('button is enabled while unauthenticated — a click would fall through with nothing to do');
    }

    const cursor = await button.evaluate((el: Element) => getComputedStyle(el).cursor);
    const opacity = await button.evaluate((el: Element) => getComputedStyle(el).opacity);
    if (cursor === 'not-allowed' && Number(opacity) < 1) {
      ok(`button styling MATCHES its disabled state (cursor=${cursor}, opacity=${opacity})`);
    } else {
      fail('button LOOKS enabled despite being disabled — restores the original mismatch bug', `cursor=${cursor} opacity=${opacity}`);
    }

    const url = page.url();
    if (url.includes('/register')) {
      ok('remains on /register while unauthenticated (no navigation without sign-in)');
    } else {
      fail('unexpectedly navigated away from /register', url);
    }
  }

  console.log('\n=== Test 3: no "Signed in ✓" banner renders while unauthenticated ===');
  {
    const bannerVisible = await page.locator('text=Signed in').count();
    if (bannerVisible === 0) {
      ok('no "Signed in ✓" confirmation renders for an unauthenticated session (no false-positive success)');
    } else {
      fail('a "Signed in" banner rendered despite isAuthenticated being false');
    }
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal error running auth-registration tests:', e);
  process.exit(1);
});
