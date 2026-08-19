import Stripe from 'stripe';
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { adminUnconfiguredResponse } from '@/lib/route-auth';
import { retrieveSubscription, subscriptionPeriod } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function persistSubscription(uid: string, subscription: Stripe.Subscription) {
  const period = subscriptionPeriod(subscription);
  await adminDb().collection('parents').doc(uid).set({
    stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    stripeSubscriptionId: subscription.id,
    subscriptionStatus: subscription.status,
    currentPeriodEnd: period.currentPeriodEnd,
    cancelAtPeriodEnd: period.cancelAtPeriodEnd,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'Stripe webhook is not configured' }, { status: 503 });
  // Stripe retries a 503, so refusing here is safe: nothing is lost, the
  // event is redelivered once credentials exist.
  const unconfigured = adminUnconfiguredResponse();
  if (unconfigured) return unconfigured;

  try {
    const signature = request.headers.get('stripe-signature');
    if (!signature) return NextResponse.json({ error: 'Missing Stripe signature' }, { status: 400 });
    const body = await request.text();
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2026-07-29.dahlia' });
    const event = stripe.webhooks.constructEvent(body, signature, secret);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const uid = session.metadata?.firebaseUid;
      if (uid && typeof session.subscription === 'string') {
        await persistSubscription(uid, await retrieveSubscription(session.subscription));
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription;
      const uid = subscription.metadata?.firebaseUid;
      if (uid) await persistSubscription(uid, subscription);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    return NextResponse.json({ error: 'Invalid webhook' }, { status: 400 });
  }
}