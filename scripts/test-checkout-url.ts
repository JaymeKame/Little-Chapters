/* Regression test for the "Not a valid URL" Stripe checkout failure (see
 * lib/checkout-url.ts's checkoutReturnUrl(), used by
 * app/api/payments/checkout/route.ts).
 *
 * Root cause: success_url/cancel_url were built with plain string
 * concatenation (`${baseUrl}${path}`), so a malformed NEXT_PUBLIC_APP_URL
 * (e.g. a bare hostname with no scheme — an easy paste mistake into a
 * fresh Preview environment) produced a string Stripe's API rejects
 * outright, with nothing catching it first. checkoutReturnUrl() now builds
 * the URL with new URL() (throws immediately on a bad base instead of
 * silently producing garbage) and falls back to the actual request's own
 * origin, which can never be malformed.
 *
 * checkoutReturnUrl() lives in lib/checkout-url.ts (not the route file)
 * specifically so it has zero Next.js/Firebase imports and can be imported
 * and exercised directly here, unlike the route file itself, which pulls in
 * next/server and lib/firebase-admin (the latter initializes Firebase Admin
 * at import time and needs real credentials this sandbox doesn't have).
 *
 *   node --experimental-strip-types scripts/test-checkout-url.ts
 */

import { checkoutReturnUrl } from '../lib/checkout-url.ts';

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

function withEnv<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.NEXT_PUBLIC_APP_URL;
  if (value === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prev;
  }
}

console.log('\n=== checkoutReturnUrl(): request origin wins over a configured NEXT_PUBLIC_APP_URL (the cross-origin fix) ===');
{
  const url = withEnv('https://little-chapters-olive.vercel.app', () =>
    checkoutReturnUrl({ nextUrl: { origin: 'https://little-chapters-abc123-preview.vercel.app' } }, '/payment/cancel'),
  );
  check(
    'the initiating request origin (Preview or Production) wins over a fixed NEXT_PUBLIC_APP_URL — checkout always returns to the SAME origin it was opened from, so Firebase\'s origin-scoped session survives the round trip',
    url === 'https://little-chapters-abc123-preview.vercel.app/payment/cancel',
    url,
  );
}

console.log('\n=== checkoutReturnUrl(): Production origin is used as-is (not overridden) ===');
{
  const url = withEnv('https://little-chapters-olive.vercel.app', () =>
    checkoutReturnUrl({ nextUrl: { origin: 'https://little-chapters-olive.vercel.app' } }, '/payment/cancel'),
  );
  check(
    'checkout initiated from Production returns to Production (same origin, no behavior change there)',
    url === 'https://little-chapters-olive.vercel.app/payment/cancel',
    url,
  );
}

console.log('\n=== checkoutReturnUrl(): NEXT_PUBLIC_APP_URL missing entirely ===');
{
  const url = withEnv(undefined, () =>
    checkoutReturnUrl({ nextUrl: { origin: 'https://some-preview-abc123.vercel.app' } }, '/payment/cancel'),
  );
  check(
    'an unset NEXT_PUBLIC_APP_URL is fine — the request origin alone is sufficient',
    url === 'https://some-preview-abc123.vercel.app/payment/cancel',
    url,
  );
}

console.log('\n=== checkoutReturnUrl(): request origin itself somehow malformed — falls back to NEXT_PUBLIC_APP_URL, then localhost ===');
{
  const urlWithConfigured = withEnv('https://little-chapters.example.com', () =>
    checkoutReturnUrl({ nextUrl: { origin: '' } }, '/payment/cancel'),
  );
  check(
    'an invalid request origin falls back to a configured NEXT_PUBLIC_APP_URL',
    urlWithConfigured === 'https://little-chapters.example.com/payment/cancel',
    urlWithConfigured,
  );

  const urlNoFallback = withEnv(undefined, () => checkoutReturnUrl({ nextUrl: { origin: '' } }, '/payment/cancel'));
  check(
    'with no valid origin and no configured fallback, checkoutReturnUrl() still returns a valid absolute URL (localhost), never throws',
    urlNoFallback === 'http://localhost:3000/payment/cancel',
    urlNoFallback,
  );
}

console.log('\n=== checkoutReturnUrl(): Stripe placeholder + trailing-slash correctness ===');
{
  const url = withEnv(undefined, () =>
    checkoutReturnUrl({ nextUrl: { origin: 'https://little-chapters.example.com' } }, '/payment/success?session_id={CHECKOUT_SESSION_ID}'),
  );
  check(
    'the literal {CHECKOUT_SESSION_ID} placeholder Stripe substitutes server-side survives unencoded',
    url === 'https://little-chapters.example.com/payment/success?session_id={CHECKOUT_SESSION_ID}',
    url,
  );

  const trailingSlashUrl = withEnv(undefined, () =>
    checkoutReturnUrl({ nextUrl: { origin: 'https://little-chapters.example.com/' } }, '/payment/success'),
  );
  check(
    'a trailing slash on the request origin does not produce a double slash',
    trailingSlashUrl === 'https://little-chapters.example.com/payment/success',
    trailingSlashUrl,
  );
}

console.log('\n=== Static: the route wires both URLs through checkoutReturnUrl() ===');
{
  const { readFileSync } = await import('fs');
  const ROOT = import.meta.dirname + '/..';
  const route = readFileSync(`${ROOT}/app/api/payments/checkout/route.ts`, 'utf8');

  check(
    'the route imports checkoutReturnUrl from lib/checkout-url (not defining it locally, which Next.js route exports forbid)',
    route.includes("import { checkoutReturnUrl } from '@/lib/checkout-url';"),
  );
  check(
    'the route file itself exports no non-handler symbols (would fail Next.js\'s route-export build check)',
    !/^export (function|const) checkoutReturnUrl/m.test(route),
  );
  check(
    'successUrl/cancelUrl are both built through checkoutReturnUrl()',
    (route.match(/checkoutReturnUrl\(request,/g) ?? []).length === 2,
  );
  check(
    'the success URL still carries the literal {CHECKOUT_SESSION_ID} placeholder',
    route.includes("'/payment/success?session_id={CHECKOUT_SESSION_ID}'"),
  );
  check(
    'the old plain string-concatenation assignment is gone from live code',
    !route.includes("const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin')"),
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
