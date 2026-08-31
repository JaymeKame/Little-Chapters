'use client';

/* Warm blue banner shown when a paying parent's card failed and their
 * subscription is in a recoverable state (past_due / incomplete / unpaid).
 * Opens the Stripe billing portal so they can update the card themselves.
 *
 * Deliberately calm: no red, no urgency, no countdown, no "your child will
 * lose access!" — the free chapter is still theirs and the language mirrors
 * that. See the app's product principle: "Permission, not guilt." */

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { track } from '@/lib/analytics';

interface Subscription {
  subscribed: boolean;
  needsAttention: boolean;
  reason: 'past_due' | 'incomplete' | 'unpaid' | 'canceled' | 'inactive' | null;
}

const COPY: Record<NonNullable<Subscription['reason']>, { title: string; body: string; cta: string }> = {
  past_due: {
    title: 'Your last payment didn’t go through.',
    body: 'Update your payment method to keep new chapters coming.',
    cta: 'Update payment',
  },
  incomplete: {
    title: 'Your subscription needs one more step.',
    body: 'Confirm your payment method so we can start delivering daily chapters.',
    cta: 'Finish setup',
  },
  unpaid: {
    title: 'Your subscription is on hold.',
    body: 'Update your payment method to bring back new chapters.',
    cta: 'Update payment',
  },
  canceled: { title: '', body: '', cta: '' }, // no banner
  inactive: { title: '', body: '', cta: '' }, // no banner
};

export function PaymentAttentionBanner() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [state, setState] = useState<Subscription | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (authLoading || !isAuthenticated || !user) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/payments/subscription', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json() as Subscription;
        if (!cancelled) setState(data);
      } catch { /* offline — no banner */ }
    })();
    return () => { cancelled = true; };
  }, [authLoading, isAuthenticated, user]);

  if (!state?.needsAttention || !state.reason) return null;
  const copy = COPY[state.reason];
  if (!copy.cta) return null;

  async function openPortal() {
    if (!user || busy) return;
    setBusy(true);
    try {
      track('billing_portal_opened', { route: typeof window !== 'undefined' ? window.location.pathname : undefined });
      const token = await user.getIdToken();
      const res = await fetch('/api/payments/portal', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({})) as { url?: string };
      if (res.ok && data.url) window.location.href = data.url;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="status" style={{
      display: 'flex', alignItems: 'center', gap: 12,
      background: 'var(--sky-soft, #E9F2FA)',
      border: '1px solid var(--sky, #7EB7E6)',
      borderRadius: 12, padding: '12px 16px', margin: '12px 16px',
      color: 'var(--ink, #2B2B2B)', fontSize: 14, lineHeight: 1.5,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{copy.title}</div>
        <div style={{ color: 'var(--ink-soft, #5C5C5C)' }}>{copy.body}</div>
      </div>
      <button onClick={openPortal} disabled={busy} style={{
        background: 'var(--leaf, #2E7D63)', color: '#fff', border: 0, borderRadius: 10,
        padding: '10px 14px', fontSize: 14, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap',
      }}>{busy ? 'Opening…' : copy.cta}</button>
    </div>
  );
}
