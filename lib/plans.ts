/* Subscription plan catalogue — the CLIENT-SAFE half of lib/stripe.ts.
 *
 * This file exists because `app/payment/page.tsx` is a 'use client' module.
 * When it imported PLANS from lib/stripe.ts it dragged the whole Stripe NODE
 * sdk into the browser bundle (the /payment client chunk was ~3 MB larger
 * than /register's, and `STRIPE_SECRET_KEY not set` was being logged in the
 * BROWSER console). The secret itself never leaked — Next replaces
 * non-NEXT_PUBLIC_ env with undefined client-side — but shipping a
 * server-credential module to the browser is one refactor away from doing
 * exactly that.
 *
 * So: prices, names and copy live here (safe anywhere). Stripe price IDs and
 * the Stripe client stay in lib/stripe.ts, server-only. The client sends a
 * planId; the SERVER resolves it to a price ID (see priceIdForPlan) and is
 * the only side that ever decides what gets charged.                        */

export type PlanId = 'monthly' | 'yearly';

export interface SubscriptionPlan {
  id: PlanId;
  name: string;
  /** In cents — rendered as ${amount / 100}. */
  amount: number;
  interval: 'month' | 'year';
  currency: string;
  /** Parent-facing line under the plan name. */
  blurb: string;
}

export const PLANS: SubscriptionPlan[] = [
  {
    id: 'monthly',
    name: 'Monthly',
    // $20/month — the price the landing page has stated since the first
    // commit. The 999 that used to be here came from the payments branch as a
    // stock placeholder; the payment screen renders this number while Stripe
    // charges whatever the price ID says, so the two MUST agree.
    amount: 2000,
    interval: 'month',
    currency: 'usd',
    blurb: 'Billed monthly. Cancel anytime.',
  },
  {
    id: 'yearly',
    name: 'Yearly',
    // $200/year = two months free against $20/month.
    amount: 20000,
    interval: 'year',
    currency: 'usd',
    blurb: 'Billed yearly — two months free.',
  },
];

export function planById(id: string): SubscriptionPlan | undefined {
  return PLANS.find((plan) => plan.id === id);
}

/** How many chapters a visitor may read before the paywall. The demo arc is
 *  deliberately playable with no account at all — see lib/entitlement.ts. */
export const FREE_CHAPTERS = 1;
