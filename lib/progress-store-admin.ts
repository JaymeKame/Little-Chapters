/* Server-only Firestore access for child progress + session persistence.
 * NEVER import this from a 'use client' module — see lib/firebase-admin.ts.
 *
 * Every read/write here goes through the Admin SDK, keyed by a Firebase uid
 * ALREADY VERIFIED by the caller (lib/route-auth.ts's requireReadingUser) —
 * never a client-supplied uid. This is deliberately the ONLY way these two
 * collections are read or written: no client Firestore SDK access, no
 * Firestore security rule to deploy or maintain, because the shared project
 * (inzone-f93e4) has a pre-existing world-readable catch-all and no rule
 * scoped to these paths was ever written, let alone deployed (see
 * docs/PERSISTENCE.md and the identical, deliberately-undeployed situation
 * for readingPets in lib/pet.ts). Admin SDK writes are not subject to
 * Firestore security rules at all, so this sidesteps that problem entirely
 * rather than reproducing it for data more sensitive than pet XP. */

import { adminDb } from './firebase-admin';
import type { ChildProgress, SessionInput } from '../reading-tutor/src/types';
import {
  completeSessionPure,
  defaultProgressFor,
  normalizeProgress,
  type PersistableProgress,
  type PersistableSession,
} from './child-progress';
import { toPersistable as progressToPersistable } from '../reading-tutor/src/progression';
import type { SessionIntervention } from './reading-session-interpreter';

function childRef(uid: string, childId: string) {
  return adminDb().collection('parents').doc(uid).collection('children').doc(childId);
}

function progressRef(uid: string, childId: string) {
  return childRef(uid, childId).collection('progress').doc('current');
}

function sessionRef(uid: string, childId: string, chapterId: string) {
  return childRef(uid, childId).collection('sessions').doc(chapterId);
}

/** Load-or-create, transactional so two concurrent first loads for the same
 *  child can't race each other into writing two different "first" defaults
 *  (they'd compute the identical default anyway, but this keeps the
 *  invariant explicit rather than relying on that coincidence). */
export async function loadOrCreateProgress(
  uid: string,
  childId: string,
  ageDerivedStageEstimate: number,
): Promise<{ progress: PersistableProgress; created: boolean }> {
  const ref = progressRef(uid, childId);
  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      return { progress: snap.data() as PersistableProgress, created: false };
    }
    const fresh = defaultProgressFor(childId, ageDerivedStageEstimate);
    const persistable = progressToPersistable(fresh);
    tx.set(ref, persistable);
    return { progress: persistable, created: true };
  });
}

/** The server-side twin of lib/child-progress.ts's completeSessionLocally():
 *  identical idempotency semantics (a session already recorded under this
 *  chapterId never re-applies progression), but backed by a Firestore
 *  transaction so the guarantee holds under a genuine concurrent double-
 *  submit (double-tap, a retried request racing the first one), not just a
 *  single-threaded local call. */
export async function completeSessionRemotely(
  uid: string,
  childId: string,
  ageDerivedStageEstimate: number,
  sessionInput: SessionInput,
  interventions: SessionIntervention,
  previouslyTricky: string[],
): Promise<{ progress: PersistableProgress; applied: boolean; alreadyCompleted: boolean }> {
  const pRef = progressRef(uid, childId);
  const sRef = sessionRef(uid, childId, sessionInput.chapterId);

  return adminDb().runTransaction(async (tx) => {
    const [progressSnap, sessionSnap] = await Promise.all([tx.get(pRef), tx.get(sRef)]);

    const currentProgress: ChildProgress =
      (progressSnap.exists ? normalizeProgress(progressSnap.data()) : null) ??
      defaultProgressFor(childId, ageDerivedStageEstimate);

    const alreadyCompleted = sessionSnap.exists;

    const { nextProgress, applied, persistedSession } = completeSessionPure({
      progress: currentProgress,
      alreadyCompleted,
      sessionInput,
      interventions,
      previouslyTricky,
    });

    // Idempotent by construction: re-writing the same chapterId's session
    // record on a repeat call is safe (same content), only the progress
    // write is gated on `applied`.
    tx.set(sRef, persistedSession, { merge: true });
    const persistedProgress = progressToPersistable(nextProgress);
    if (applied) tx.set(pRef, persistedProgress);

    return { progress: persistedProgress, applied, alreadyCompleted };
  });
}

export type { PersistableProgress, PersistableSession };
