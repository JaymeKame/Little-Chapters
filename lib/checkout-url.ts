/* Builds absolute, Stripe-valid checkout-return URLs for
 * app/api/payments/checkout/route.ts. Lives outside the route file because
 * Next.js's route-export type checker rejects any named export from a
 * route.ts other than the HTTP handlers and its small config allow-list. */

/** Builds an absolute, Stripe-valid checkout-return URL. Stripe's API
 *  rejects success_url/cancel_url outright with "Not a valid URL" if the
 *  value isn't a syntactically valid absolute http(s) URL — which the old
 *  plain string concatenation (`${baseUrl}${path}`) could silently
 *  produce with no local check at all, e.g. NEXT_PUBLIC_APP_URL set to a
 *  bare hostname with no scheme (an easy paste mistake into a fresh
 *  Preview environment's env vars).
 *
 *  NEXT_PUBLIC_APP_URL is tried FIRST via new URL() (never string
 *  concatenation, so a malformed value throws immediately instead of
 *  silently producing garbage) and normally wins on Production, where it
 *  names the real public domain Stripe should redirect the browser back
 *  to. If it is missing or fails to parse, request.nextUrl.origin — the
 *  origin Next.js itself already computed for this exact incoming
 *  request — is the fallback: it can never be malformed, and is
 *  automatically correct on every Preview deployment (each one mints its
 *  own unique *.vercel.app hostname) with no env var to keep in sync.
 *
 *  Takes the narrow `{ nextUrl: { origin } }` shape rather than the full
 *  NextRequest type — the only thing this needs — so it's plain-object
 *  testable without constructing a real NextRequest, which needs the
 *  Next.js runtime and can't be built from bare Node outside it. A real
 *  NextRequest satisfies this structurally, so callers are unaffected. */
export function checkoutReturnUrl(request: { nextUrl: { origin: string } }, path: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    try {
      return new URL(path, configured).toString();
    } catch {
      console.error('[payments/checkout] NEXT_PUBLIC_APP_URL is not a valid URL base — falling back to the request origin');
    }
  }
  try {
    return new URL(path, request.nextUrl.origin).toString();
  } catch {
    return new URL(path, 'http://localhost:3000').toString();
  }
}
