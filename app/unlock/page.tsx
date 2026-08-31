'use client';

/* The paywall — reached only after a child has finished the free demo
 * chapter and the parent wants tomorrow's.
 *
 * This is a PARENT screen, so the child-screen rules (one big button, no
 * reading required) do not apply — but "permission, not guilt" still does:
 * no streak-loss warnings, no countdown, no "don't let them fall behind".
 * It says what tomorrow contains, what it costs, and offers a way back to
 * Momo that is a real option rather than a dark-pattern decline link.
 *
 * One button, whose destination depends on where the parent already is:
 * signed out → /register (account + phone), signed in → /payment (plans).
 * Both funnel to Stripe Checkout and come back through /payment/success.   */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useEntitlement } from '@/lib/use-entitlement';
import { PLANS } from '@/lib/plans';
import { track } from '@/lib/analytics';

export default function UnlockPage() {
  const router = useRouter();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { ready, subscribed } = useEntitlement();

  // A parent who subscribes in another tab (or lands here on a stale link)
  // should never be staring at a paywall they already paid.
  useEffect(() => {
    if (ready && subscribed) router.replace('/home');
  }, [ready, subscribed, router]);

  useEffect(() => { track('unlock_shown', { route: '/unlock', authed: isAuthenticated }); }, [isAuthenticated]);

  const monthly = PLANS.find((plan) => plan.id === 'monthly');

  function goForward() {
    router.push(isAuthenticated ? '/payment' : '/register');
  }

  return (
    <div className="screen" style={{ padding: '24px 20px', maxWidth: 440, margin: '0 auto' }}>
      <header style={{ textAlign: 'center', marginTop: 12, marginBottom: 26 }}>
        <p style={{ fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-soft)', margin: '0 0 10px' }}>
          That's the end of the free chapter
        </p>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: 30, lineHeight: 1.2, margin: 0 }}>
          The story keeps going tomorrow.
        </h1>
      </header>

      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: 16,
          padding: '20px 22px',
          marginBottom: 20,
        }}
      >
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 15, lineHeight: 1.7, color: 'var(--ink-2)' }}>
          <li>A brand-new chapter every day, written at their level</li>
          <li>Gentle help with the words they find tricky</li>
          <li>A short note for you after each session — what they practised, never a score</li>
          <li>Momo remembers their streak</li>
        </ul>
      </div>

      <p style={{ textAlign: 'center', fontSize: 15, color: 'var(--ink-soft)', margin: '0 0 20px' }}>
        {monthly ? `$${(monthly.amount / 100).toFixed(0)} a month.` : ''} Cancel anytime.
      </p>

      <button
        onClick={goForward}
        className="btn-primary"
        disabled={authLoading}
        style={{
          width: '100%',
          padding: '16px',
          fontSize: 16,
          fontWeight: 600,
          borderRadius: 12,
          border: 0,
          background: 'var(--leaf)',
          color: '#fff',
          cursor: authLoading ? 'not-allowed' : 'pointer',
          opacity: authLoading ? 0.6 : 1,
        }}
      >
        {isAuthenticated ? 'Choose your plan' : 'Create your account'}
      </button>

      <button
        onClick={() => router.push('/home')}
        style={{
          width: '100%',
          padding: '12px',
          fontSize: 14,
          marginTop: 10,
          borderRadius: 12,
          border: 0,
          background: 'transparent',
          color: 'var(--ink-soft)',
          cursor: 'pointer',
        }}
      >
        Not tonight — back to Momo
      </button>

      <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-soft)', marginTop: 20, lineHeight: 1.6 }}>
        Your free chapter stays readable as many times as they like.
      </p>
    </div>
  );
}
