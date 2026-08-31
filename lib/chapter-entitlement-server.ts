import { adminDb } from './firebase-admin';
import { hasActiveSubscription } from './entitlement-server';
import { decideChapterEntitlement, type ChapterEntitlementSource } from './chapter-entitlement-policy';

export function dailyChapterRef(chapterId: string) {
  return adminDb().collection('dailyChapters').doc(Buffer.from(chapterId).toString('base64url'));
}

function freeEntitlementRef(uid: string) {
  return adminDb().collection('freeChapterEntitlements').doc(uid);
}

export async function ownedDailyChapter(uid: string, chapterId: string) {
  const snapshot = await dailyChapterRef(chapterId).get();
  return snapshot.exists && snapshot.data()?.ownerUid === uid ? snapshot : null;
}

/** Existing chapters always remain recoverable. New generation is allowed
 * through exactly one of the two commercial gates, with no quality tier. */
export async function resolveChapterEntitlement(uid: string, chapterId: string): Promise<ChapterEntitlementSource | null> {
  const existing = await ownedDailyChapter(uid, chapterId);
  // Packages created before free generation existed were necessarily paid;
  // preserve that provenance instead of accidentally spending a free use.
  const existingSource = existing ? (existing.data()?.entitlementSource === 'free' ? 'free' : 'subscription') : null;
  if (existingSource) return existingSource;
  if (uid === 'anonymous') return 'free'; // explicit local-development stand-in only
  const subscribed = await hasActiveSubscription(uid);
  const spent = await freeEntitlementRef(uid).get();
  return decideChapterEntitlement({ chapterId, existingSource, subscribed, consumedFreeChapterId: spent.data()?.chapterId ?? null });
}

/** Called only after canonical session completion. Attempts never spend the
 * free chapter, and repeated completion is an idempotent merge. */
export async function consumeFreeChapterIfApplicable(uid: string, chapterId: string): Promise<void> {
  const chapter = await ownedDailyChapter(uid, chapterId);
  if (!chapter || chapter.data()?.entitlementSource !== 'free') return;
  await freeEntitlementRef(uid).set({ chapterId, consumedAt: new Date().toISOString() }, { merge: true });
}
