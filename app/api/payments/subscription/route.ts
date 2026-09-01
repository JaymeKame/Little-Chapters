/* GET /api/payments/subscription — the load-bearing entitlement + billing
 * state read.
 *
 * Two callers depend on this route:
 *   1. lib/use-entitlement.ts — reads `subscribed:boolean` to decide whether
 *      the paywall opens. Anything the server cannot prove is active must
 *      leave `subscribed:false` so the client falls back to the demo path.
 *   2. Manage Account / payment-attention banner — needs to distinguish an
 *      inactive account (never subscribed / canceled long ago) from a
 *      RECOVERABLE billing state (past_due / incomplete / unpaid) so the
 *      parent gets a warm "update your card" prompt instead of an
 *      unexplained silent lock.
 *
 * Response shape (backwards-compatible: `subscribed` boolean still present):
 *   {
 *     subscribed: boolean,
 *     needsAttention: boolean,       // true when a recoverable state exists
 *     reason: 'past_due' | 'incomplete' | 'unpaid' | 'canceled' | 'inactive' | null,
 *     subscription: null | {
 *       id, status, currentPeriodEnd, cancelAtPeriodEnd, items
 *     }
 *   }
 *
 * Never trusts parents/{uid}.subscriptionStatus (client-writable until the
 * Firestore rules land — see lib/stripe.ts customerBelongsTo). */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { adminUnconfiguredResponse } from '@/lib/route-auth';
import { customerBelongsTo, subscriptionPeriod } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Recoverable = the parent CAN self-service their way back to active by
 *  opening the billing portal and updating the payment method. Everything
 *  else is either fine (active/trialing) or terminal (canceled/inactive). */
const RECOVERABLE_STATUSES = new Set<Stripe.Subscription.Status>(['past_due', 'incomplete', 'unpaid']);
const ACTIVE_STATUSES = new Set<Stripe.Subscription.Status>(['active', 'trialing']);

function pickBest(subs: Stripe.Subscription[]): Stripe.Subscription | null {
  // Prefer active > trialing > past_due > incomplete > unpaid > canceled;
  // within a bucket, prefer the newest.
  const rank: Record<string, number> = {
    active: 0, trialing: 1, past_due: 2, incomplete: 3, unpaid: 4, canceled: 5, incomplete_expired: 6, paused: 7,
  };
  const sorted = [...subs].sort((a, b) => {
    const ra = rank[a.status] ?? 99;
    const rb = rank[b.status] ?? 99;
    if (ra !== rb) return ra - rb;
    return (b.created ?? 0) - (a.created ?? 0);
  });
  return sorted[0] ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const unconfigured = adminUnconfiguredResponse();
    if (unconfigured) return unconfigured;

    const auth = adminAuth();
    const db = adminDb();

    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization header' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(token);
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const uid = decodedToken.uid;

    const parentDoc = await db.collection('parents').doc(uid).get();
    const parentData = parentDoc.data();
    const customerId = parentData?.stripeCustomerId;

    if (!customerId) {
      return NextResponse.json({ subscribed: false, needsAttention: false, reason: null, subscription: null });
    }

    if (!(await customerBelongsTo(customerId, uid, decodedToken.email ?? null))) {
      console.warn('[payments/subscription] stored stripeCustomerId does not belong to uid:', uid);
      return NextResponse.json({ subscribed: false, needsAttention: false, reason: null, subscription: null });
    }

    // Read ALL statuses so a past_due/incomplete row can inform needsAttention;
    // getCustomerSubscription() below deliberately filters to active only, and
    // that filter is exactly what previously hid recoverable states from the
    // UI. Direct list is intentional here.
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
      // Configured/unconfigured is a server truth, not the parent's problem —
      // fail closed on `subscribed`, but say nothing about `needsAttention`
      // (we have no idea).
      return NextResponse.json({ subscribed: false, needsAttention: false, reason: null, subscription: null });
    }
    const stripe = new Stripe(secret, { apiVersion: '2026-07-29.dahlia' });
    const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
    const chosen = pickBest(list.data);

    if (!chosen) {
      return NextResponse.json({ subscribed: false, needsAttention: false, reason: null, subscription: null });
    }

    const period = subscriptionPeriod(chosen);
    const isActive = ACTIVE_STATUSES.has(chosen.status);
    const isRecoverable = RECOVERABLE_STATUSES.has(chosen.status);
    const reason = isActive ? null : isRecoverable ? chosen.status : chosen.status === 'canceled' ? 'canceled' : 'inactive';

    return NextResponse.json({
      subscribed: isActive,
      needsAttention: isRecoverable,
      reason,
      subscription: {
        id: chosen.id,
        status: chosen.status,
        currentPeriodEnd: period.currentPeriodEnd,
        cancelAtPeriodEnd: period.cancelAtPeriodEnd,
        items: chosen.items.data.map((item) => ({
          priceId: item.price?.id || '',
          quantity: item.quantity || 1,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
