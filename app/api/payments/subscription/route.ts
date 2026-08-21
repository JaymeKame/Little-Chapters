/* API route for getting subscription status */

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { adminUnconfiguredResponse } from '@/lib/route-auth';
import { customerBelongsTo, getCustomerSubscription, subscriptionPeriod } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const unconfigured = adminUnconfiguredResponse();
    if (unconfigured) return unconfigured;

    const auth = adminAuth();
    const db = adminDb();

    // Verify authentication
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

    // Get parent's Stripe customer ID
    const parentDoc = await db.collection('parents').doc(uid).get();
    const parentData = parentDoc.data();
    const customerId = parentData?.stripeCustomerId;

    if (!customerId) {
      return NextResponse.json({ subscribed: false, subscription: null });
    }

    // The stored id is client-writable until Firestore rules land, and this
    // route hands back a customer's subscription id, status, period end and
    // price ids — and now also decides whether the paywall opens. Without
    // this check, planting someone else's customer id in your own parent doc
    // both reads their billing state back to you and unlocks the app. An id
    // that is not ours is answered exactly like no id at all — never a
    // distinct error, which would confirm the id exists.
    if (!(await customerBelongsTo(customerId, uid, decodedToken.email ?? null))) {
      console.warn('[payments/subscription] stored stripeCustomerId does not belong to uid:', uid);
      return NextResponse.json({ subscribed: false, subscription: null });
    }

    // Get subscription status
    const subscription = await getCustomerSubscription(customerId);

    if (!subscription) {
      return NextResponse.json({ subscribed: false, subscription: null });
    }

    const period = subscriptionPeriod(subscription);
    return NextResponse.json({
      subscribed: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        currentPeriodEnd: period.currentPeriodEnd,
        cancelAtPeriodEnd: period.cancelAtPeriodEnd,
        items: subscription.items.data.map((item: any) => ({
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
