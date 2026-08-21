'use client';

/* Who may open the NEXT chapter.
 *
 * The product rule: the demo arc is free to ANYONE — no account, no card, no
 * setup beyond picking a name and three interests. When that first chapter
 * ends and the parent wants to keep going, they sign in and subscribe.
 *
 * Two facts decide it, and they are deliberately stored in different places:
 *
 *  1. Has the free chapter been spent? Chapter history (localStorage, per
 *     uid, written by /read on completion). Local because a child may never
 *     have signed in at all — there is no server record of an anonymous
 *     visitor's reading to consult.
 *  2. Is there an active subscription? /api/payments/subscription, which
 *     verifies the customer against Stripe server-side. Never a localStorage
 *     flag, and never the parents/{uid} doc read directly — that doc is
 *     client-writable until the Firestore rules land (see CLAUDE.md), so a
 *     planted subscriptionStatus would unlock the app.
 *
 * ENFORCEMENT SPLIT — this module is the UX gate, not DRM. The demo text is
 * static and generated client-side (lib/chapters.ts), so it cannot be
 * withheld by a client check and there is nothing to protect by trying. What
 * actually costs money is AI chapter generation, and that is gated
 * server-side in /api/chapters/story via lib/entitlement-server.ts. That
 * split is why this module fails OPEN on an indeterminate answer (see
 * `subscribed: null` in use-entitlement.ts): a network blip must never lock
 * a paying family out of the bedtime chapter, and the downside if it does
 * let someone through is a second helping of the same demo story.          */

import { loadChapterHistoryLocal } from './chapter-history';
import { FREE_CHAPTERS } from './plans';

export { FREE_CHAPTERS };

/** Chapters this uid has actually finished. localStorage-backed and
 *  synchronous, so screens can gate their first paint without a round trip. */
export function chaptersCompleted(uid: string | null): number {
  if (typeof window === 'undefined') return 0;
  return loadChapterHistoryLocal(uid).length;
}

/** Has the free demo been used up? */
export function freeChapterSpent(uid: string | null): boolean {
  return chaptersCompleted(uid) >= FREE_CHAPTERS;
}
