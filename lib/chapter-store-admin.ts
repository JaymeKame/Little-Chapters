/* SERVER-ONLY Firestore access for the persisted "today's chapter" record.
 * NEVER import this from a 'use client' module — see lib/firebase-admin.ts.
 *
 * Same shape of tradeoff as lib/progress-store-admin.ts: every read/write
 * goes through the Admin SDK, keyed by a Firebase uid ALREADY VERIFIED by
 * the caller (lib/route-auth.ts's requireReadingUser) — never a client-
 * supplied uid. Admin SDK writes are not subject to Firestore security
 * rules, so this sidesteps the same undeployed-rules situation documented
 * in progress-store-admin.ts and firestore.rules.
 *
 * Why this exists: lib/chapters.ts's TUTOR_CACHE_PREFIX localStorage cache
 * is per-BROWSER, not per-account. Two devices (or a cleared browser)
 * signed into the same subscriber account could each independently call
 * OpenAI and cache a DIFFERENT generated chapter for the same child on the
 * same day — the product rule "same child + same day always gets the same
 * actual chapter" only held by accident (single-device use), not by
 * construction. This file makes the persisted record, keyed by
 * uid + childId + calendar day, the actual source of truth for the
 * GENERATED path; the demo/fallback arc (lib/chapters.ts's chapterFor())
 * stays a pure deterministic function of the same inputs and needs no
 * persistence of its own — there is nothing to regenerate. */

import { adminDb } from './firebase-admin';
import type { StoryDraft } from '../reading-tutor/src/validators';
import type { StoryBlueprint } from './story-blueprint.ts';

export interface PersistedChapterRecord {
  day: string; // YYYY-MM-DD, child-local (see lib/chapter-id.ts)
  chapterId: string;
  stage: number;
  source: 'generated' | 'fallback';
  entitlementSource?: 'free' | 'subscription';
  draft?: StoryDraft;
  skeletonId?: string;
  slots?: Record<string, string>;
  blueprint?: StoryBlueprint;
  createdAt: string;
}

function childRef(uid: string, childId: string) {
  return adminDb().collection('parents').doc(uid).collection('children').doc(childId);
}

function chapterDayRef(uid: string, childId: string, day: string) {
  return childRef(uid, childId).collection('chapters').doc(day);
}

export async function loadTodayChapter(uid: string, childId: string, day: string): Promise<PersistedChapterRecord | null> {
  const snap = await chapterDayRef(uid, childId, day).get();
  return snap.exists ? (snap.data() as PersistedChapterRecord) : null;
}

/** The one decision rule get-or-create runs on every existence check: only
 *  a `source: 'generated'` record is authoritative. `null`/`undefined`
 *  (nothing persisted yet) and a `'fallback'` record (a past attempt that
 *  failed) are both "not yet generated" — get-or-create must retry
 *  generation for either, never short-circuit on them. Exported as a pure
 *  function, with no Firestore dependency, specifically so this rule is
 *  directly testable without a live Admin SDK connection. */
export function isAuthoritativeChapterRecord(record: PersistedChapterRecord | null | undefined): boolean {
  return record?.source === 'generated';
}

/** Get-or-create: if a GENERATED record already exists for this
 *  uid+childId+day, returns it UNCHANGED — no regeneration, no re-persist,
 *  regardless of what `generate` would produce this time. Otherwise calls
 *  `generate()` once.
 *
 *  Only a `source: 'generated'` result is ever written. A `'fallback'`
 *  result (OpenAI unreachable, rate-limited, or the validator exhausted
 *  its retries) is returned to THIS caller for THIS request only and is
 *  deliberately left unpersisted — same as the pre-existing demo/fallback
 *  arc's own behavior, which was never cached against a failure either.
 *  Persisting a fallback as if it were authoritative would permanently
 *  lock a child into demo content for the rest of the day the moment a
 *  single OpenAI call hiccups, on every device, with no way to recover
 *  until midnight — worse than the multi-device divergence this store
 *  exists to fix. A pre-existing fallback record from before this fix
 *  shipped is likewise treated as "nothing generated yet" and retried.
 *
 *  Generation happens OUTSIDE the transaction — an OpenAI call can take
 *  seconds and Firestore transactions retry on contention, which would
 *  either hold the transaction open far too long or fire the network call
 *  multiple times. Instead: check existence first (fast path, the common
 *  case after the first successful generation of the day), generate if
 *  needed, then re-check inside the transaction right before writing. Two
 *  requests racing to be first can both call `generate()`, but only the
 *  winner's GENERATED result is ever persisted or returned — a losing
 *  racer's fallback is discarded, and a losing racer's generated draft is
 *  discarded in favor of whichever generated result the transaction saw
 *  first. That rare double-generation cost is accepted; what's guaranteed
 *  is that every caller for this uid+childId+day converges on the SAME
 *  persisted GENERATED chapter once one exists, and that a fallback never
 *  creates a regeneration loop once a real chapter has been persisted —
 *  the existence check above always short-circuits before `generate()` is
 *  ever called again. */
export async function getOrCreateTodayChapter(
  uid: string,
  childId: string,
  day: string,
  chapterId: string,
  stage: number,
  generate: () => Promise<Omit<PersistedChapterRecord, 'day' | 'chapterId' | 'stage' | 'createdAt'>>,
): Promise<{ record: PersistedChapterRecord; created: boolean }> {
  const ref = chapterDayRef(uid, childId, day);

  const existing = await ref.get();
  const existingData = existing.exists ? (existing.data() as PersistedChapterRecord) : null;
  if (isAuthoritativeChapterRecord(existingData)) return { record: existingData as PersistedChapterRecord, created: false };

  const generated = await generate();
  if (generated.source !== 'generated') {
    // Ephemeral — this request's answer only, never written, so the next
    // request (this device, a refresh, a different device) tries again.
    return {
      record: { day, chapterId, stage, createdAt: new Date().toISOString(), ...generated },
      created: false,
    };
  }

  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const snapData = snap.exists ? (snap.data() as PersistedChapterRecord) : null;
    if (isAuthoritativeChapterRecord(snapData)) return { record: snapData as PersistedChapterRecord, created: false };
    const record: PersistedChapterRecord = {
      day,
      chapterId,
      stage,
      createdAt: new Date().toISOString(),
      ...generated,
    };
    tx.set(ref, record);
    return { record, created: true };
  });
}
