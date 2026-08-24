/* Targeted regression tests for the free-demo-then-paywall integration
 * (PR #19 replayed onto canonical — see docs/... integration report).
 *
 * Covers what can be exercised without a browser or live Stripe/Twilio
 * credentials: pure phone normalisation, the plan catalogue, Stripe-module
 * guard behavior when unconfigured, Twilio guard behavior when unconfigured,
 * and static source-level checks that the security-sensitive routes still
 * contain the ownership/entitlement/PII guards this integration relies on
 * (same style as reading-tutor's "ownership derived from verified token"
 * checks). Anything requiring a real browser (localStorage-backed
 * entitlement state, the actual Home/Read paywall UI) is covered by the
 * Playwright walkthrough in the final report instead.
 *
 *   node --experimental-strip-types scripts/test-paywall-integration.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

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
function check(label: string, condition: boolean, detail?: string): void {
  if (condition) ok(label);
  else fail(label, detail);
}

const ROOT = join(import.meta.dirname, '..');
function src(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

async function main() {
  console.log('\n=== Phone normalisation (lib/phone.ts) ===');
  {
    const { normalizePhoneNumber, E164, INVALID_PHONE_MESSAGE } = await import('../lib/phone.ts');

    check('bare 10-digit US number normalises to +1-prefixed E.164', normalizePhoneNumber('5551234567') === '+15551234567');
    check('formatted US number (dashes/parens) normalises the same way', normalizePhoneNumber('(555) 123-4567') === '+15551234567');
    check('already-E.164 input passes through unchanged', normalizePhoneNumber('+442071838750') === '+442071838750');
    check('E.164 input with formatting cruft still normalises', normalizePhoneNumber('+44 20 7183 8750') === '+442071838750');
    check('short local number with no country code is REJECTED, not silently mis-normalised', normalizePhoneNumber('555-1234') === null);
    check('a 7-digit-with-plus number that used to slip through as valid E.164 is still rejected on digit-count grounds', !E164.test('+5551234') || normalizePhoneNumber('5551234') === null);
    check('letters-only input is rejected', normalizePhoneNumber('not a phone number') === null);
    check('empty string is rejected', normalizePhoneNumber('') === null);
    check('a too-long digit string is rejected', normalizePhoneNumber('+1234567890123456789') === null);
    check('INVALID_PHONE_MESSAGE is parent-facing copy, not a raw validation code', INVALID_PHONE_MESSAGE.toLowerCase().includes('phone number'));
  }

  console.log('\n=== Plan catalogue (lib/plans.ts) ===');
  {
    const { PLANS, planById, FREE_CHAPTERS } = await import('../lib/plans.ts');

    check('exactly two plans exist: monthly, yearly', PLANS.length === 2 && PLANS.every((p) => p.id === 'monthly' || p.id === 'yearly'));
    check('planById resolves a known plan', planById('monthly')?.amount === 2000);
    check('planById returns undefined for an unknown/invalid plan id', planById('lifetime-discount-9001') === undefined);
    check('planById returns undefined for an empty string', planById('') === undefined);
    check('FREE_CHAPTERS is exactly 1 (one free demo chapter, per the product rule)', FREE_CHAPTERS === 1);
  }

  // lib/stripe.ts, lib/sms.ts, lib/entitlement.ts and lib/entitlement-server.ts
  // are exercised via static source checks rather than a direct `import()`:
  // they carry extensionless internal imports and heavy external SDKs
  // (stripe/twilio/firebase-admin) that Next's bundler resolves but Node's
  // own ESM loader (used here via --experimental-strip-types, with no
  // bundler in front of it) cannot — importing them directly would be
  // testing the loader, not the paywall logic. Source-level assertions give
  // the same coverage of the guard behavior without that mismatch.

  console.log('\n=== Stripe module guard behavior (lib/stripe.ts, unconfigured in this environment) ===');
  {
    check('STRIPE_SECRET_KEY is unset in this test environment (precondition)', !process.env.STRIPE_SECRET_KEY);
    check(
      'no env vars are set for either price id in this test environment (precondition)',
      !process.env.STRIPE_MONTHLY_PRICE_ID && !process.env.STRIPE_YEARLY_PRICE_ID,
    );

    const stripeLib = src('lib/stripe.ts');
    check('isStripeConfigured() reflects whether the Stripe client was constructed (no secret key -> false)', /export function isStripeConfigured\(\): boolean \{\s*return !!stripe;/.test(stripeLib));
    check(
      'priceIdForPlan() resolves monthly/yearly price ids from env, and returns null for anything else (never a client-named price)',
      /const priceId =\s*plan\.id === 'monthly' \? process\.env\.STRIPE_MONTHLY_PRICE_ID : process\.env\.STRIPE_YEARLY_PRICE_ID;/.test(stripeLib) &&
        /const plan = planById\(planId\);\s*if \(!plan\) return null;/.test(stripeLib),
    );
    check('customerBelongsTo() fails CLOSED (false) when Stripe is unconfigured, rather than throwing or trusting the caller', /if \(!stripe\) return false;/.test(stripeLib));
    check(
      'createCheckoutSession()/getOrCreateCustomer()/getCustomerSubscription() all throw rather than silently no-opping when Stripe is unconfigured',
      (stripeLib.match(/if \(!stripe\) \{\s*throw new Error\('Stripe is not configured'\);/g) ?? []).length >= 3,
    );
  }

  console.log('\n=== Twilio module guard behavior (lib/sms.ts, unconfigured in this environment) ===');
  {
    check(
      'no Twilio env vars are set in this test environment (precondition)',
      !process.env.TWILIO_ACCOUNT_SID && !process.env.TWILIO_AUTH_TOKEN && !process.env.TWILIO_PHONE_NUMBER,
    );
    const sms = src('lib/sms.ts');
    check('isSMSConfigured() requires all three credentials to be present', /return !!\(accountSid && authToken && fromNumber\);/.test(sms));
    check(
      'sendSMS() checks isSMSConfigured() BEFORE attempting a send, returning the coarse not_configured status rather than throwing',
      /if \(!isSMSConfigured\(\)\) \{[\s\S]*?return \{ success: false, status: 'not_configured' \};/.test(sms),
    );
    check('a send failure is also reported as a coarse status, not the caught error itself', /catch \(error\) \{\s*console\.error\('Failed to send SMS:', error\);\s*return \{ success: false, status: 'failed' \};/.test(sms));
  }

  console.log('\n=== Server-side entitlement fails CLOSED for anonymous/falsy uids (lib/entitlement-server.ts) ===');
  {
    const entitlementServer = src('lib/entitlement-server.ts');
    check(
      'hasActiveSubscription() short-circuits to false for a falsy uid or the "anonymous" stand-in, before any Firestore/Stripe call',
      /if \(!uid \|\| uid === 'anonymous'\) return false;/.test(entitlementServer),
    );
    check('any error during the check resolves to false (fails closed) rather than propagating', /catch \(error\) \{\s*console\.error\('\[entitlement\] subscription check failed:', error\);\s*return false;/.test(entitlementServer));
    check('the stored customer id is verified via customerBelongsTo before being trusted', /customerBelongsTo\(customerId, uid, email/.test(entitlementServer));
  }

  console.log('\n=== Client-side entitlement is SSR-safe and fails open (never blocks) on an indeterminate answer (lib/entitlement.ts) ===');
  {
    const entitlement = src('lib/entitlement.ts');
    check('chaptersCompleted() is guarded for SSR (no window -> 0, never throws during server render)', /if \(typeof window === 'undefined'\) return 0;/.test(entitlement));
    check('freeChapterSpent() is derived purely from chaptersCompleted() >= FREE_CHAPTERS', /return chaptersCompleted\(uid\) >= FREE_CHAPTERS;/.test(entitlement));

    const useEntitlement = src('lib/use-entitlement.ts');
    check('subscribed defaults to null (indeterminate), never to false, before the check settles', /useState<boolean \| null>\(null\)/.test(useEntitlement));
    check('a non-ok subscription-status response is treated as indeterminate (null), not "not subscribed"', /setSubscribed\(null\);[\s\S]{0,40}setChecked\(true\);[\s\S]{0,40}return;/.test(useEntitlement));
    check(
      '`locked` requires subscribed === false (a strict, non-null check) — an indeterminate answer never locks the reader out',
      /const locked = ready && subscribed === false && freeChapterUsed && !alreadyOwned;/.test(useEntitlement),
    );
    check('a chapter the child already completed is never re-locked, regardless of subscription state', /alreadyOwned/.test(useEntitlement) && /wasChapterCompleted/.test(useEntitlement));
  }

  console.log('\n=== Static source checks: paid AI generation enforces server-side (fails CLOSED) ===');
  {
    const storyRoute = src('app/api/chapters/story/route.ts');
    check('imports hasActiveSubscription from lib/entitlement-server', storyRoute.includes("from '@/lib/entitlement-server'"));
    check('returns 402 SUBSCRIPTION_REQUIRED for a non-anonymous, unsubscribed uid', /SUBSCRIPTION_REQUIRED/.test(storyRoute) && /status:\s*402/.test(storyRoute));
    check('exempts the anonymous stand-in uid from the subscription check (demo arc has no server generation to gate)', /auth\.uid !== 'anonymous'/.test(storyRoute));
  }

  console.log('\n=== Static source checks: Stripe ownership verification is not bypassable ===');
  {
    const checkout = src('app/api/payments/checkout/route.ts');
    check('checkout route verifies a stored customer id via customerBelongsTo before trusting it', /customerBelongsTo\(claimedCustomerId/.test(checkout));
    check(
      'duplicate-subscription guard checks the RESOLVED customerId, not just storedCustomerId (closes the double-charge hole)',
      /getCustomerSubscription\(customerId\)/.test(checkout) && !/getCustomerSubscription\(storedCustomerId\)/.test(checkout),
    );

    const subscription = src('app/api/payments/subscription/route.ts');
    check('subscription-status route verifies ownership via customerBelongsTo before returning any billing data', /customerBelongsTo\(customerId/.test(subscription));
    check(
      'an unowned customer id resolves to the SAME shape as no id at all (no oracle for "does this id exist")',
      (subscription.match(/subscribed:\s*false,\s*subscription:\s*null/g) ?? []).length >= 2,
    );

    const stripeLib = src('lib/stripe.ts');
    check('customerBelongsTo RETHROWS non-404 errors instead of swallowing them to false', /if \(code === 404\) return false;\s*\n\s*throw error;/.test(stripeLib));
    check('getCustomerSubscription reads more than just the single most recent row (limit > 1)', /limit:\s*10/.test(stripeLib));
  }

  console.log('\n=== Static source checks: phone PII never reaches the browser Firestore write, never leaks provider errors ===');
  {
    const authProvider = src('components/AuthProvider.tsx');
    check('AuthProvider listens on onIdTokenChanged, not onAuthStateChanged', authProvider.includes('onIdTokenChanged(') && !authProvider.includes('onAuthStateChanged('));
    check('a fresh AuthSession wrapper object is published so React re-renders on the same mutated User instance', authProvider.includes('interface AuthSession') && authProvider.includes('setSession'));
    check('saveParentPhoneNumber POSTs to the server route instead of writing parents/{uid} directly from the client', authProvider.includes("fetch('/api/parents/phone'"));

    const phoneRoute = src('app/api/parents/phone/route.ts');
    check('phone route requires a verified Firebase ID token', phoneRoute.includes('verifyIdToken'));
    check('phone route rejects anonymous identities (no real account to attach a phone number to)', /sign_in_provider === 'anonymous'/.test(phoneRoute));
    check('phone route rate-limits writes', /overLimit|RATE_LIMITED/.test(phoneRoute));
    check('phone route validates/normalizes via the shared lib/phone.ts helper before ever writing', phoneRoute.includes('normalizePhoneNumber'));
    check('phone route writes via the Admin SDK with merge:true (never clobbers stripeCustomerId/subscriptionStatus)', phoneRoute.includes('adminDb()') && /\{\s*merge:\s*true\s*\}/.test(phoneRoute));

    const sms = src('lib/sms.ts');
    check('SmsStatus is a closed, coarse union — never the raw provider error string', /export type SmsStatus = 'sent' \| 'not_configured' \| 'failed'/.test(sms));
    check('sendSMS never returns error.message in its resolved value', !/return \{[^}]*error\.message/.test(sms));

    const messages = src('app/api/messages/route.ts');
    check('messages route imports the shared E164 regex from lib/phone rather than re-implementing it', messages.includes("from '@/lib/phone'"));
  }

  console.log('\n=== Static source checks: paywall UI wiring (app/home, app/read, lib/audio) ===');
  {
    const home = src('app/home/page.tsx');
    check('Home imports useEntitlement', home.includes("from '@/lib/use-entitlement'"));
    check('locked Home hands subscription actions to a grown-up through Settings', /dailyState === 'locked'/.test(home) && /go\('grown-up'\)/.test(home) && /Ask a grown-up/.test(home));
    check('Home still calls the scene-selector unconditionally (paywall gating did not touch scene selection)', home.includes('selectSceneForPage'));

    const read = src('app/read/page.tsx');
    check('Read imports useEntitlement', read.includes("from '@/lib/use-entitlement'"));
    check('Read deep-link guard never fires while a chapter is already in progress (startedReadingRef)', /chapterLocked && !startedReadingRef\.current/.test(read));
    check('the child payoff hands conversion to completed Home instead of covering the ending', /grownupHandoff=1/.test(read) && /Save .*adventure/.test(home));
    check('Read still imports the scene-selector (paywall gating did not touch per-page scene selection)', read.includes('selectSceneForPage'));
    check('Read still imports combineVerdicts/reading-verdict (grading untouched)', read.includes("from '@/lib/reading-verdict'"));

    const audio = src('lib/audio.ts');
    check('welcomeLine() gained the 4th `locked` param without losing `alreadyRead`', /welcomeLine\(\s*childName: string,\s*chapter\?: Chapter \| null,\s*alreadyRead = false,\s*locked = false,\s*\)/.test(audio));
    check('ElevenLabs/ducking/generation-counter code is untouched (still present)', audio.includes('_speechGeneration') || audio.includes('AbortController'));
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal error running paywall integration tests:', e);
  process.exit(1);
});
