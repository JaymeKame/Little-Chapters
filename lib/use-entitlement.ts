'use client';

/* useEntitlement(chapterId) — "may this child open this chapter right now?"
 *
 * Used by /home (to point Play at the paywall instead of /read) and by /read
 * itself (to bounce a deep link). See lib/entitlement.ts for the rule and
 * for why the client half is allowed to fail open.                          */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { freeChapterSpent } from './entitlement';
import { wasChapterCompleted } from './chapter-history';

/* Subscription status per uid, so Home → Read → chapter-end does not refetch
 * on every navigation. Module-level (not sessionStorage) on purpose: it must
 * die with the tab rather than outlive a cancellation. */
const statusCache = new Map<string, boolean>();

/** Drops the memoised status — call after checkout returns, so /home
 *  unlocks without a hard reload. */
export function clearEntitlementCache(uid?: string | null): void {
  if (uid) statusCache.delete(uid);
  else statusCache.clear();
}

export interface Entitlement {
  /** Both auth and the subscription check have settled. Screens should not
   *  gate anything (or render a locked state) until this is true. */
  ready: boolean;
  signedIn: boolean;
  /** null = could not determine (offline, route unconfigured). Never treated
   *  as "no" — see the enforcement-split note in lib/entitlement.ts. */
  subscribed: boolean | null;
  freeChapterUsed: boolean;
  /** True when this chapter is behind the paywall for this visitor. */
  locked: boolean;
  refresh: () => Promise<void>;
}

export function useEntitlement(chapterId?: string | null): Entitlement {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [checked, setChecked] = useState(false);

  const read = useCallback(
    async (force: boolean): Promise<void> => {
      if (!user || !isAuthenticated) {
        setSubscribed(false);
        setChecked(true);
        return;
      }
      if (!force) {
        const cached = statusCache.get(user.uid);
        if (cached !== undefined) {
          setSubscribed(cached);
          setChecked(true);
          return;
        }
      }
      try {
        const token = await user.getIdToken();
        const response = await fetch('/api/payments/subscription', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          // 503 (admin unconfigured) / 5xx / offline: indeterminate, not "no".
          setSubscribed(null);
          setChecked(true);
          return;
        }
        const data = (await response.json()) as { subscribed?: boolean };
        const active = Boolean(data.subscribed);
        statusCache.set(user.uid, active);
        setSubscribed(active);
        setChecked(true);
      } catch {
        setSubscribed(null);
        setChecked(true);
      }
    },
    [user, isAuthenticated],
  );

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    void (async () => {
      await read(false);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, read]);

  const ready = !authLoading && checked;
  // Guarded on `ready` so the localStorage reads below never run during the
  // server render (authLoading is true there) — same trick /home already
  // uses for wasChapterCompleted.
  const freeChapterUsed = ready ? freeChapterSpent(user?.uid ?? null) : false;
  // Re-reading a chapter the child already finished stays free forever: the
  // demo is theirs, and a locked screen where a familiar story used to be is
  // the one paywall a five-year-old would actually experience.
  const alreadyOwned = ready && !!chapterId && wasChapterCompleted(user?.uid ?? null, chapterId);
  const locked = ready && subscribed === false && freeChapterUsed && !alreadyOwned;

  return {
    ready,
    signedIn: isAuthenticated,
    subscribed,
    freeChapterUsed,
    locked,
    refresh: () => read(true),
  };
}
