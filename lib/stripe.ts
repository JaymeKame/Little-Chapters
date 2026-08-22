/* Stripe payment library for Little-Chapters subscriptions.
 * Handles customer creation, subscription management, and payment methods.
 *
 * SERVER-ONLY. Never import this from a 'use client' module — it holds the
 * Stripe secret key and the Node sdk. Client code that needs plan names and
 * prices imports lib/plans.ts instead, and sends a planId the server
 * resolves through priceIdForPlan() below.                                  */

import Stripe from 'stripe';
import { PLANS, planById, type PlanId, type SubscriptionPlan } from './plans';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  console.warn('STRIPE_SECRET_KEY not set - Stripe features will be disabled');
}

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, {
  apiVersion: '2026-07-29.dahlia',
}) : null;

export { PLANS, planById };
export type { PlanId, SubscriptionPlan };

/** Resolves a client-supplied planId to the Stripe price it may be charged
 *  at. The price ID is env-only and never leaves the server, so a client can
 *  ask for "monthly" but can never name its own price. */
export function priceIdForPlan(planId: string): string | null {
  const plan = planById(planId);
  if (!plan) return null;
  const priceId =
    plan.id === 'monthly' ? process.env.STRIPE_MONTHLY_PRICE_ID : process.env.STRIPE_YEARLY_PRICE_ID;
  return priceId?.trim() || null;
}

export function isStripeConfigured(): boolean {
  return !!stripe;
}

/** TEMPORARY diagnostic — presence-only booleans for the env vars checkout
 *  depends on, NEVER the values themselves. Added to answer one question:
 *  does the Vercel runtime actually see STRIPE_SECRET_KEY/
 *  STRIPE_MONTHLY_PRICE_ID/STRIPE_YEARLY_PRICE_ID after they were added to
 *  a Preview environment and it was redeployed, when "Stripe is not
 *  configured" persisted anyway. `stripeSecretPresent` reflects the value
 *  `stripe` above was actually constructed from at module load (not a
 *  fresh re-read), which is itself diagnostic: if this endpoint later shows
 *  the var present but checkout still fails the same way, the var arrived
 *  too late for THIS running instance (e.g. a cached build reused an old
 *  env snapshot) rather than being genuinely missing. Read fresh from
 *  process.env for the other three, none of which this module caches. See
 *  app/api/payments/debug/route.ts and the checkout route's 500 body. */
export function stripeEnvDiagnostics(): {
  stripeSecretPresent: boolean;
  monthlyPricePresent: boolean;
  yearlyPricePresent: boolean;
  appUrlPresent: boolean;
} {
  return {
    stripeSecretPresent: !!stripe,
    monthlyPricePresent: Boolean(process.env.STRIPE_MONTHLY_PRICE_ID),
    yearlyPricePresent: Boolean(process.env.STRIPE_YEARLY_PRICE_ID),
    appUrlPresent: Boolean(process.env.NEXT_PUBLIC_APP_URL),
  };
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
      const adopted = existingCustomers.data[0];
      // Stamp the uid on a customer we adopted by email. Without this the
      // customer stays unstamped and customerBelongsTo can only ever match it
      // on email — so if the parent later changes their Google/Apple account
      // email, ownership of their own live subscription fails permanently.
      if (metadata?.firebaseUid && adopted.metadata?.firebaseUid !== metadata.firebaseUid) {
        try {
          await stripe.customers.update(adopted.id, { metadata: { ...adopted.metadata, ...metadata } });
        } catch {
          /* best-effort: the email match still identifies them today */
        }
      }
      return adopted.id;
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
  } catch (error) {
    // "This customer does not exist" is a real answer: not yours. Anything
    // else — a 429, a 5xx, a network blip — means we could not DETERMINE
    // ownership, and answering `false` there is dangerous: callers treat
    // false as "not the caller's customer" and take a fallback path, which
    // for checkout meant skipping the already-subscribed guard on a
    // transient Stripe hiccup. Fail loudly instead of guessing.
    const code = (error as { statusCode?: number })?.statusCode;
    if (code === 404) return false;
    throw error;
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
    // limit: 1 used to sit here, which reads only the customer's most recent
    // subscription. A parent whose newest row is `incomplete` (an abandoned
    // checkout) or `past_due` while an older one is still active would have
    // come back "not subscribed" — and this now gates access to the app, not
    // just a status badge. Read a page and pick the active one.
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit: 10,
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
