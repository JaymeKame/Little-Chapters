/* POST /api/parents/delete — parent-initiated account deletion.
 *
 * WHAT THIS DOES (safely):
 *   1. Verifies the Firebase ID token — no anonymous callers.
 *   2. Reads parents/{uid} to find any owned Stripe customer.
 *   3. If the customer belongs to this uid, cancels any active/trialing
 *      subscription (`cancel_at_period_end: false` — immediate). We do NOT
 *      delete the Stripe customer itself: Stripe retains billing history
 *      for tax/audit and the customer object is Stripe's, not ours.
 *   4. Deletes the account-owned Firestore data whose ownership we can
 *      prove: parents/{uid} and its children/{childId} subtree written by
 *      lib/profile-store-admin.ts, lib/preferences.ts,
 *      lib/progress-store-admin.ts, and lib/chapter-store-admin.ts.
 *   5. Deletes the Firebase Auth user (adminAuth.deleteUser).
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *   - It does NOT recursively wipe collections whose ownership is
 *     ambiguous. The shared Firebase project (see CLAUDE.md) has legacy
 *     collections from other apps; a broad recursive delete keyed on uid
 *     could damage sibling projects. Only the parents/{uid} tree — which
 *     this app CREATED — is removed.
 *   - It does NOT delete client-side localStorage: the caller clears its
 *     own storage on success.
 *   - It does NOT delete Stripe invoices or historical charges.
 *
 * This is server-mediated via the Firebase Admin SDK. Admin writes bypass
 * Firestore rules, so this works even before the shared project's rules
 * are scoped down. See lib/firestore.rules and CLAUDE.md.                */

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb, adminCredentialsConfigured } from '@/lib/firebase-admin';
import { customerBelongsTo } from '@/lib/stripe';
import Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function deleteSubcollection(parentPath: string, name: string): Promise<void> {
  const db = adminDb();
  const col = db.collection(parentPath).doc().parent; // no-op to keep types sane
  void col;
  const ref = db.collection(`${parentPath}/${name}`);
  const snap = await ref.get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

async function deleteParentTree(uid: string): Promise<{ removed: string[] }> {
  const db = adminDb();
  const parentRef = db.collection('parents').doc(uid);
  const removed: string[] = [];

  // Children/{childId}/{progress,sessions,chapters,preferences,...}
  const childrenSnap = await parentRef.collection('children').get();
  for (const childDoc of childrenSnap.docs) {
    for (const name of ['progress', 'sessions', 'chapters', 'preferences', 'reports', 'history']) {
      try {
        await deleteSubcollection(`parents/${uid}/children/${childDoc.id}`, name);
        removed.push(`children/${childDoc.id}/${name}`);
      } catch { /* subcollection absent — that's fine */ }
    }
    await childDoc.ref.delete();
    removed.push(`children/${childDoc.id}`);
  }

  // Direct parent-owned subcollections (preferences, messages)
  for (const name of ['preferences', 'messages']) {
    try {
      await deleteSubcollection(`parents/${uid}`, name);
      removed.push(name);
    } catch { /* absent */ }
  }

  // The doc itself
  const parentDoc = await parentRef.get();
  if (parentDoc.exists) {
    await parentRef.delete();
    removed.push('parents/' + uid);
  }

  return { removed };
}

export async function POST(request: NextRequest) {
  if (!adminCredentialsConfigured()) {
    return NextResponse.json({ error: 'ADMIN_NOT_CONFIGURED' }, { status: 503 });
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  }

  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(authHeader.slice(7));
  } catch {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  }
  if (decoded.firebase?.sign_in_provider === 'anonymous') {
    return NextResponse.json({ error: 'ANONYMOUS_NOT_DELETABLE', hint: 'Sign in first — anonymous sessions have no persistent account to delete.' }, { status: 400 });
  }

  const uid = decoded.uid;
  const email = decoded.email ?? null;
  const outcomes = { subscriptionCanceled: false, dataRemoved: [] as string[], authUserDeleted: false };

  // 1. Cancel active/trialing subscription, if any and if it truly belongs to us.
  try {
    const parentSnap = await adminDb().collection('parents').doc(uid).get();
    const customerId = parentSnap.data()?.stripeCustomerId;
    if (typeof customerId === 'string' && customerId && await customerBelongsTo(customerId, uid, email)) {
      const secret = process.env.STRIPE_SECRET_KEY;
      if (secret) {
        const stripe = new Stripe(secret, { apiVersion: '2026-07-29.dahlia' });
        const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
        for (const sub of list.data) {
          if (sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due' || sub.status === 'incomplete' || sub.status === 'unpaid') {
            await stripe.subscriptions.cancel(sub.id);
            outcomes.subscriptionCanceled = true;
          }
        }
      }
    }
  } catch (error) {
    console.error('[parents/delete] subscription cancel failed for uid=%s: %s', uid, (error as Error).message);
    // Continue — we would rather delete the account data than leave the
    // parent unable to delete because Stripe had a hiccup. The parent can
    // still cancel from the Stripe portal by other means; more importantly
    // the customer is Stripe's, not ours.
  }

  // 2. Delete Firestore tree we created.
  try {
    const { removed } = await deleteParentTree(uid);
    outcomes.dataRemoved = removed;
  } catch (error) {
    console.error('[parents/delete] firestore tree delete failed for uid=%s: %s', uid, (error as Error).message);
    return NextResponse.json({ error: 'FIRESTORE_DELETE_FAILED', partial: outcomes }, { status: 500 });
  }

  // 3. Delete the Firebase Auth user. This has to be last: once it runs,
  //    subsequent calls with the same token would fail auth verification.
  try {
    await adminAuth().deleteUser(uid);
    outcomes.authUserDeleted = true;
  } catch (error) {
    console.error('[parents/delete] auth user delete failed for uid=%s: %s', uid, (error as Error).message);
    return NextResponse.json({ error: 'AUTH_USER_DELETE_FAILED', partial: outcomes }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...outcomes });
}
