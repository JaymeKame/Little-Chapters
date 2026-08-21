/* Server-side subscription check. SERVER-ONLY — imports lib/stripe.ts.
 *
 * This is the half of the paywall that has to be right. lib/entitlement.ts
 * decides what the child SEES; this decides what actually gets spent, and so
 * it fails CLOSED: any answer we cannot establish is "not subscribed".
 *
 * It deliberately does NOT trust parents/{uid}.subscriptionStatus, even
 * though the webhook and the verify route both write it. Firestore rules for
 * this project are not deployed yet (CLAUDE.md), so that document is
 * client-writable — a visitor could set subscriptionStatus: 'active' on
 * their own doc and unlock paid generation. The stored customer id gets the
 * same treatment: it is only a POINTER, checked against Stripe's own record
 * of who owns that customer before anything is read from it.               */

import { adminDb } from './firebase-admin';
import { customerBelongsTo, getCustomerSubscription } from './stripe';

export async function hasActiveSubscription(uid: string, email?: string | null): Promise<boolean> {
  // 'anonymous' is route-auth's stand-in uid for local dev running open (no
  // admin credentials, or SPEECH_ALLOW_UNAUTH=1). It is not a real account.
  if (!uid || uid === 'anonymous') return false;
  try {
    const snap = await adminDb().collection('parents').doc(uid).get();
    const customerId = snap.data()?.stripeCustomerId;
    if (typeof customerId !== 'string' || !customerId) return false;
    if (!(await customerBelongsTo(customerId, uid, email ?? null))) {
      console.warn('[entitlement] stored stripeCustomerId does not belong to uid:', uid);
      return false;
    }
    // getCustomerSubscription already narrows to active/trialing.
    return Boolean(await getCustomerSubscription(customerId));
  } catch (error) {
    console.error('[entitlement] subscription check failed:', error);
    return false;
  }
}
