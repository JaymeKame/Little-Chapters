'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { clearEntitlementCache } from '@/lib/use-entitlement';
import { track } from '@/lib/analytics';

// Webhook-driven fields (subscription status) can lag the browser's own
// verify call by a few seconds. A single failed attempt does not mean the
// payment failed — retry a few times before showing anything discouraging.
const VERIFY_RETRY_DELAYS_MS = [1500, 3000, 5000];

export default function PaymentSuccessPage() {
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading, signInWithGoogle } = useAuth();
  const [message, setMessage] = useState('Confirming your subscription...');
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function verify() {
      // Stripe returns here as a FULL page load, so auth is still resolving
      // on the first pass. Returning early without waiting meant the
      // verification call never fired at all. This is genuine
      // initialization, not "unauthenticated" — the message must not imply
      // a sign-in problem while it's still true.
      if (authLoading) return;
      // isAuthenticated is false for the anonymous session AuthProvider
      // auto-creates when there is no persisted Firebase user at all — a
      // real "sign in again" case (e.g. Stripe returned to a different
      // origin than checkout started from, so this origin never had the
      // parent's session to restore). Offer an actual way out instead of a
      // dead end: signing in here re-runs this effect (isAuthenticated
      // flips true) and verification proceeds with the session_id already
      // in the URL.
      if (!user || !isAuthenticated) {
        setMessage('Please sign in again so we can confirm your payment.');
        setNeedsSignIn(true);
        return;
      }
      setNeedsSignIn(false);
      const sessionId = new URLSearchParams(window.location.search).get('session_id');
      if (!sessionId) { setMessage('This payment link is missing its session.'); return; }

      for (let attempt = 0; attempt <= VERIFY_RETRY_DELAYS_MS.length; attempt++) {
        if (cancelled) return;
        try {
          const response = await fetch(`/api/payments/verify?session_id=${encodeURIComponent(sessionId)}`, {
            headers: { Authorization: `Bearer ${await user.getIdToken()}` },
          });
          if (!response.ok) throw new Error('verification failed');
          // The paywall memoises "not subscribed" per uid for the tab's
          // lifetime; without this the parent pays and /home still sends
          // them back to /unlock until they hard-reload.
          clearEntitlementCache(user.uid);
          track('checkout_completed', { route: '/payment/success' });
          track('subscription_active', { route: '/payment/success' });
          if (!cancelled) router.replace('/home');
          return;
        } catch {
          const delay = VERIFY_RETRY_DELAYS_MS[attempt];
          if (delay === undefined) break;
          if (!cancelled) setMessage('Your payment went through — just finishing confirmation...');
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
      if (!cancelled) setMessage('We could not confirm the payment yet. Please try again shortly.');
    }
    void verify();
    return () => { cancelled = true; };
  }, [authLoading, isAuthenticated, router, user]);

  async function handleSignIn() {
    setSignInError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
    }
  }

  return (
    <main className="screen" style={{ padding: 24, textAlign: 'center' }}>
      <h1>Almost there</h1>
      <p>{message}</p>
      {needsSignIn && (
        <>
          <button type="button" onClick={handleSignIn} style={{ marginTop: 16 }}>
            Sign in with Google
          </button>
          {signInError && <p style={{ color: '#B3261E' }}>{signInError}</p>}
        </>
      )}
    </main>
  );
}