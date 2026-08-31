/* SERVER-ONLY Firestore access for the parent's child-profile mirror.
 * NEVER import this from a 'use client' module — see lib/firebase-admin.ts.
 *
 * lib/profile.ts's ChildProfile is a single global (not even uid-scoped)
 * localStorage key — correct for the mockup's account-free onboarding, but
 * it means a returning subscriber on a NEW browser/device, or one who
 * cleared site data, has NO profile at all client-side and was being
 * treated as a brand-new anonymous visitor (bounced to '/'). This mirrors
 * the profile onto `parents/{uid}.childProfile` (Admin SDK, same
 * undeployed-rules situation as every other field already written there —
 * stripeCustomerId, phoneNumber, subscriptionStatus — see firestore.rules
 * and lib/entitlement-server.ts) so app/home and app/read can restore it
 * for any signed-in caller before concluding "no profile exists".
 *
 * Storing directly on the parent doc (not under children/{childId}, unlike
 * progress/sessions/chapters) is deliberate: restoring the profile is how
 * childId itself gets rediscovered on a fresh device — there is no
 * childId to partition by until the profile it lives on has been loaded. */

import { adminDb } from './firebase-admin';
import type { ChildProfile } from './profile';

function parentRef(uid: string) {
  return adminDb().collection('parents').doc(uid);
}

function isPlausibleProfile(raw: unknown): raw is ChildProfile {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Partial<ChildProfile>;
  return typeof r.childId === 'string' && typeof r.childName === 'string' && Array.isArray(r.interests);
}

export async function loadRemoteProfile(uid: string): Promise<ChildProfile | null> {
  const snap = await parentRef(uid).get();
  const raw = snap.data()?.childProfile;
  return isPlausibleProfile(raw) ? raw : null;
}

/** Best-effort upsert — callers never block on this (see lib/profile.ts's
 *  mirrorProfileRemote, fire-and-forget from the client). merge:true so this
 *  never disturbs stripeCustomerId/subscriptionStatus/phoneNumber already
 *  on the same document. */
export async function saveRemoteProfile(uid: string, profile: ChildProfile): Promise<void> {
  await parentRef(uid).set({ childProfile: profile }, { merge: true });
}
