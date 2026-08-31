/* Builds absolute, Stripe-valid checkout-return URLs for
 * app/api/payments/checkout/route.ts. Lives outside the route file because
 * Next.js's route-export type checker rejects any named export from a
 * route.ts other than the HTTP handlers and its small config allow-list. */

/** Builds an absolute, Stripe-valid checkout-return URL. Stripe's API
 *  rejects success_url/cancel_url outright with "Not a valid URL" if the
 *  value isn't a syntactically valid absolute http(s) URL — which plain
 *  string concatenation (`${baseUrl}${path}`) could silently produce with
 *  no local check at all, e.g. NEXT_PUBLIC_APP_URL set to a bare hostname
 *  with no scheme (an easy paste mistake into a fresh Preview
 *  environment's env vars).
 *
 *  request.nextUrl.origin — the origin Next.js itself already computed for
 *  this exact incoming request — is tried FIRST and normally wins: the
 *  browser's checkout fetch is same-origin, so this is always exactly the
 *  origin the parent is looking at, whether that's a Preview deployment or
 *  Production. Preferring a configured NEXT_PUBLIC_APP_URL instead was the
 *  live bug: a fixed production domain there sent every Preview checkout's
 *  success_url/cancel_url back to Production, a DIFFERENT origin than the
 *  one Stripe Checkout was opened from. Firebase Auth's browser persistence
 *  is origin-scoped (IndexedDB) — the parent's just-completed sign-in on
 *  Preview does not exist on Production, so the return trip looked signed
 *  out even though checkout itself succeeded. NEXT_PUBLIC_APP_URL is kept
 *  only as a last-resort fallback for the case request.nextUrl.origin is
 *  itself somehow missing/invalid, which real NextRequest instances never
 *  produce.
 *
 *  Takes the narrow `{ nextUrl: { origin } }` shape rather than the full
 *  NextRequest type — the only thing this needs — so it's plain-object
 *  testable without constructing a real NextRequest, which needs the
 *  Next.js runtime and can't be built from bare Node outside it. A real
 *  NextRequest satisfies this structurally, so callers are unaffected. */
export function checkoutReturnUrl(request: { nextUrl: { origin: string } }, path: string): string {
  try {
    return new URL(path, request.nextUrl.origin).toString();
  } catch {
    console.error('[payments/checkout] request.nextUrl.origin is not a valid URL base — falling back to NEXT_PUBLIC_APP_URL');
  }
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    try {
      return new URL(path, configured).toString();
    } catch {
      /* falls through to the localhost fallback below */
    }
  }
  return new URL(path, 'http://localhost:3000').toString();
}
