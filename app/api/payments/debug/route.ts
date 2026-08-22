/* TEMPORARY diagnostic endpoint. Answers exactly one question: does the
 * Vercel runtime actually see the Stripe env vars, after
 * STRIPE_SECRET_KEY / STRIPE_MONTHLY_PRICE_ID / STRIPE_YEARLY_PRICE_ID were
 * added to the Preview environment and it was redeployed, when
 * /api/payments/checkout kept returning "Stripe is not configured" anyway.
 *
 * Exposes PRESENCE-ONLY booleans — never a secret value, a price ID, or
 * even a masked/partial value. Safe to leave reachable without auth while
 * debugging: there is nothing in this response an attacker could use.
 * Intentionally does NOT change any Stripe behavior — see lib/stripe.ts's
 * stripeEnvDiagnostics() for the shared logic this and the checkout
 * route's 500 body both use.
 *
 * Open directly in a browser: GET /api/payments/debug
 *
 * Remove this route once the env var question is answered. */

import { NextResponse } from 'next/server';
import { stripeEnvDiagnostics } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(stripeEnvDiagnostics());
}
