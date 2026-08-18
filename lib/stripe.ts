/* Stripe payment library for Little-Chapters subscriptions.
 * Handles customer creation, subscription management, and payment methods. */

import Stripe from 'stripe';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  console.warn('STRIPE_SECRET_KEY not set - Stripe features will be disabled');
}

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, {
  apiVersion: '2026-07-29.dahlia',
}) : null;

export interface SubscriptionPlan {
  id: string;
  name: string;
  priceId: string;
  amount: number;
  interval: 'month' | 'year';
  currency: string;
}

// Subscription plans for Little-Chapters
export const PLANS: SubscriptionPlan[] = [
  {
    id: 'monthly',
    name: 'Monthly',
    priceId: process.env.STRIPE_MONTHLY_PRICE_ID || '',
    amount: 999, // $9.99
    interval: 'month',
    currency: 'usd',
  },
  {
    id: 'yearly',
    name: 'Yearly',
    priceId: process.env.STRIPE_YEARLY_PRICE_ID || '',
    amount: 9999, // $99.99
    interval: 'year',
    currency: 'usd',
  },
];

export function isStripeConfigured(): boolean {
  return !!stripe;
}

/**
 * Create a Stripe checkout session for subscription
 */
export async function createCheckoutSession(
  customerId: string,
  priceId: string,
  successUrl: string,
  cancelUrl: string,
  metadata: Record<string, string> = {},
): Promise<{ url: string } | null> {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }

  try {
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata,
      subscription_data: { metadata },
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      customer_update: {
        address: 'auto',
      },
    });

    return { url: session.url! };
  } catch (error) {
    console.error('Error creating checkout session:', error);
    throw error;
  }
}

/**
 * Create or retrieve a Stripe customer
 */
export async function getOrCreateCustomer(
  email: string,
  name: string | null,
  metadata?: Record<string, string>,
): Promise<string> {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }

  try {
    // Try to find existing customer by email
    const existingCustomers = await stripe.customers.list({
      email: email.toLowerCase(),
      limit: 1,
    });

    if (existingCustomers.data.length > 0) {
      return existingCustomers.data[0].id;
    }

    // Create new customer
    const customer = await stripe.customers.create({
      email: email.toLowerCase(),
      name: name || undefined,
      metadata,
    });

    return customer.id;
  } catch (error) {
    console.error('Error creating/retrieving customer:', error);
    throw error;
  }
}

/**
 * Server-side ownership check: parents/{uid}.stripeCustomerId is written by
 * webhooks/checkout, but Firestore rules are not deployed yet, so a client
 * could plant a foreign customer id in its own doc. Before acting on a
 * stored id, confirm the Stripe customer actually belongs to this user —
 * via the firebaseUid metadata stamped at creation, or the account email
 * (covers customers matched by email before metadata existed).
 */
export async function customerBelongsTo(customerId: string, uid: string, email?: string | null): Promise<boolean> {
  if (!stripe) return false;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer || customer.deleted) return false;
    if (customer.metadata?.firebaseUid === uid) return true;
    return !!email && !!customer.email && customer.email.toLowerCase() === email.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Newer Stripe API versions moved current_period_end off the Subscription
 * onto its items — read whichever exists instead of throwing on undefined.
 */
export function subscriptionPeriod(subscription: Stripe.Subscription): { currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } {
  const sub = subscription as unknown as {
    current_period_end?: number;
    cancel_at_period_end?: boolean;
    items?: { data?: Array<{ current_period_end?: number }> };
  };
  const end = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return {
    currentPeriodEnd: end ? new Date(end * 1000).toISOString() : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
  };
}

/**
 * Get customer's subscription status
 */
export async function getCustomerSubscription(customerId: string) {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }

  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit: 1,
    });

    return subscriptions.data.find((subscription) =>
      subscription.status === 'active' || subscription.status === 'trialing',
    ) || null;
  } catch (error) {
    console.error('Error fetching subscription:', error);
    throw error;
  }
}

export async function retrieveCheckoutSession(sessionId: string) {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }
  return stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['subscription'],
  });
}

export async function retrieveSubscription(subscriptionId: string) {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }
  return stripe.subscriptions.retrieve(subscriptionId);
}

/**
 * Cancel customer's subscription
 */
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }

  try {
    await stripe.subscriptions.cancel(subscriptionId);
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    throw error;
  }
}

/**
 * Create a customer portal session for managing payment methods
 */
export async function createPortalSession(
  customerId: string,
  returnUrl: string,
): Promise<{ url: string } | null> {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return { url: session.url };
  } catch (error) {
    console.error('Error creating portal session:', error);
    throw error;
  }
}
