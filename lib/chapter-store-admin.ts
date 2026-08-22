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

export interface PersistedChapterRecord {
  day: string; // YYYY-MM-DD, child-local (see lib/chapter-id.ts)
  chapterId: string;
  stage: number;
  source: 'generated' | 'fallback';
  draft?: StoryDraft;
  skeletonId?: string;
  slots?: Record<string, string>;
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

/** Get-or-create: if a record already exists for this uid+childId+day,
 *  returns it UNCHANGED — no regeneration, no re-persist, regardless of
 *  what `generate` would produce this time. Otherwise calls `generate()`
 *  once and persists whatever it returns (tagged 'generated' or
 *  'fallback' by the caller), so a refresh, a second tab, or a second
 *  device never produces a second chapter for the same day.
 *
 *  Generation happens OUTSIDE the transaction — an OpenAI call can take
 *  seconds and Firestore transactions retry on contention, which would
 *  either hold the transaction open far too long or fire the network call
 *  multiple times. Instead: check existence first (fast path, the common
 *  case after the first request of the day), generate if needed, then
 *  re-check inside the transaction right before writing. Two requests
 *  racing to be first can both call `generate()`, but only the winner's
 *  result is ever persisted or returned — the loser's is discarded. That
 *  rare double-generation cost is accepted; what's guaranteed is that
 *  every caller for this uid+childId+day converges on the SAME persisted
 *  record. */
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
  if (existing.exists) return { record: existing.data() as PersistedChapterRecord, created: false };

  const generated = await generate();

  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return { record: snap.data() as PersistedChapterRecord, created: false };
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
