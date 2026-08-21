/* API route for creating Stripe checkout sessions */

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { adminUnconfiguredResponse } from '@/lib/route-auth';
import {
  createCheckoutSession,
  customerBelongsTo,
  getCustomerSubscription,
  getOrCreateCustomer,
  planById,
  priceIdForPlan,
} from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
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
    const email = decodedToken.email;

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Parse request body
    const body = await request.json();
    const { planId } = body;

    if (!planId) {
      return NextResponse.json({ error: 'planId is required' }, { status: 400 });
    }

    const plan = planById(planId);
    if (!plan) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }

    // Resolved here, server-side, from env — the client only ever names a
    // plan id, never a price.
    const priceId = priceIdForPlan(plan.id);
    if (!priceId) {
      return NextResponse.json({ error: 'Plan price ID not configured' }, { status: 500 });
    }

    // Get or create Stripe customer
    const parentDoc = await db.collection('parents').doc(uid).get();
    const parentData = parentDoc.data();
    const name = parentData?.name || null;

    // The stored id is client-writable until Firestore rules land. An id that
    // does not actually belong to this account is ignored rather than
    // rejected: that covers a deleted or stale customer as well as a planted
    // one, and self-heals via the write below. Rejecting outright would lock
    // a legitimate parent out of checkout whenever their customer went away.
    const claimedCustomerId = typeof parentData?.stripeCustomerId === 'string' ? parentData.stripeCustomerId : null;
    const storedCustomerId =
      claimedCustomerId && (await customerBelongsTo(claimedCustomerId, uid, email))
        ? claimedCustomerId
        : null;
    if (claimedCustomerId && !storedCustomerId) {
      console.warn('[payments/checkout] stored stripeCustomerId does not belong to uid — ignoring:', uid);
    }
    const customerId = storedCustomerId || await getOrCreateCustomer(email, name, { firebaseUid: uid });

    // Probe the customer we are actually about to bill, NOT storedCustomerId.
    // storedCustomerId is null on the ownership-fallback path, and
    // getOrCreateCustomer's email lookup can hand back the very customer that
    // already holds the subscription — so keying this guard on the stored id
    // let the fallback path skip it and charge a subscribed parent twice.
    // customerId is caller-owned on both branches (a verified stored id, or a
    // customer matched/created against the verified token email), so this
    // leaks nothing. It also runs before the Firestore write below, so an
    // already-subscribed parent's stored id is never overwritten.
    if (await getCustomerSubscription(customerId)) {
      return NextResponse.json({ error: 'An active subscription already exists' }, { status: 409 });
    }

    // Save customer ID to Firestore
    await db.collection('parents').doc(uid).set(
      {
        stripeCustomerId: customerId,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    // Create checkout session
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin') || 'http://localhost:3000';
    const successUrl = `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/payment/cancel`;

    const session = await createCheckoutSession(customerId, priceId, successUrl, cancelUrl, { firebaseUid: uid });

    if (!session) {
      return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
