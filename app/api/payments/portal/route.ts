/* API route for creating Stripe customer portal sessions */

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { adminUnconfiguredResponse } from '@/lib/route-auth';
import { createPortalSession, customerBelongsTo } from '@/lib/stripe';
import { billingPortalConfigurationId, billingPortalReturnUrl } from '@/lib/billing-portal';

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

    // Get parent's Stripe customer ID
    const parentDoc = await db.collection('parents').doc(uid).get();
    const parentData = parentDoc.data();
    const customerId = parentData?.stripeCustomerId;

    if (!customerId) {
      return NextResponse.json({ error: 'No Stripe customer found' }, { status: 404 });
    }

    // The stored id is client-writable until Firestore rules land — confirm
    // the customer really belongs to this account before opening its portal.
    if (!(await customerBelongsTo(customerId, uid, decodedToken.email ?? null))) {
      return NextResponse.json({ error: 'Customer does not belong to this account' }, { status: 403 });
    }

    // Create portal session
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin') || 'http://localhost:3000';
    // Returning to Settings remounts its subscription-status effect, so the
    // plan shown in Little Chapters reflects portal upgrades/cancellation.
    // Returning to /payment previously showed checkout cards and did not
    // reliably refresh the current subscription.
    const returnUrl = billingPortalReturnUrl(baseUrl);

    const session = await createPortalSession(customerId, returnUrl, billingPortalConfigurationId());

    if (!session) {
      return NextResponse.json({ error: 'Failed to create portal session' }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Error creating portal session:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
