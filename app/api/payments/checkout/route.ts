/* API route for creating Stripe checkout sessions */

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { createCheckoutSession, getCustomerSubscription, getOrCreateCustomer, PLANS } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
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

    const plan = PLANS.find((p) => p.id === planId);
    if (!plan) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }

    if (!plan.priceId) {
      return NextResponse.json({ error: 'Plan price ID not configured' }, { status: 500 });
    }

    // Get or create Stripe customer
    const parentDoc = await db.collection('parents').doc(uid).get();
    const parentData = parentDoc.data();
    const name = parentData?.name || null;

    const storedCustomerId = typeof parentData?.stripeCustomerId === 'string' ? parentData.stripeCustomerId : null;
    const customerId = storedCustomerId || await getOrCreateCustomer(email, name, { firebaseUid: uid });

    if (storedCustomerId && await getCustomerSubscription(storedCustomerId)) {
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

    const session = await createCheckoutSession(customerId, plan.priceId, successUrl, cancelUrl, { firebaseUid: uid });

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
