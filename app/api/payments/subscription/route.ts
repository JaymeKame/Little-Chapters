/* API route for getting subscription status */

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { getCustomerSubscription } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
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

    // Get parent's Stripe customer ID
    const parentDoc = await db.collection('parents').doc(uid).get();
    const parentData = parentDoc.data();
    const customerId = parentData?.stripeCustomerId;

    if (!customerId) {
      return NextResponse.json({ subscribed: false, subscription: null });
    }

    // Get subscription status
    const subscription = await getCustomerSubscription(customerId);

    if (!subscription) {
      return NextResponse.json({ subscribed: false, subscription: null });
    }

    // Extract subscription data with proper type handling
    const subData = subscription as any;
    return NextResponse.json({
      subscribed: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        currentPeriodEnd: subData.current_period_end ? new Date(subData.current_period_end * 1000).toISOString() : null,
        cancelAtPeriodEnd: subData.cancel_at_period_end || false,
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
