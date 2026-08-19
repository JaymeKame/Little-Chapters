import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { retrieveCheckoutSession, retrieveSubscription } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization header' }, { status: 401 });
    }

    const decoded = await adminAuth().verifyIdToken(authHeader.slice(7));
    const sessionId = request.nextUrl.searchParams.get('session_id');
    if (!sessionId) return NextResponse.json({ error: 'session_id is required' }, { status: 400 });

    const session = await retrieveCheckoutSession(sessionId);
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    const db = adminDb();
    const parentRef = db.collection('parents').doc(decoded.uid);
    const parent = await parentRef.get();
    const expectedCustomerId = parent.data()?.stripeCustomerId;

    if (!customerId || customerId !== expectedCustomerId || session.metadata?.firebaseUid !== decoded.uid) {
      return NextResponse.json({ error: 'Checkout session does not belong to this account' }, { status: 403 });
    }
    if (session.payment_status !== 'paid' || typeof session.subscription !== 'string') {
      return NextResponse.json({ error: 'Payment has not completed' }, { status: 409 });
    }

    const subscription = await retrieveSubscription(session.subscription);
    if (!['active', 'trialing'].includes(subscription.status)) {
      return NextResponse.json({ error: 'Subscription is not active' }, { status: 409 });
    }

    const subscriptionData = subscription as unknown as { current_period_end: number; cancel_at_period_end: boolean };

    await parentRef.set({
      subscriptionStatus: subscription.status,
      stripeSubscriptionId: subscription.id,
      currentPeriodEnd: new Date(subscriptionData.current_period_end * 1000).toISOString(),
      cancelAtPeriodEnd: subscriptionData.cancel_at_period_end,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    return NextResponse.json({ subscribed: true, status: subscription.status });
  } catch (error) {
    console.error('Error verifying checkout session:', error);
    return NextResponse.json({ error: 'Unable to verify payment' }, { status: 500 });
  }
}