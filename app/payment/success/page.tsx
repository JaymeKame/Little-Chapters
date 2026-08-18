'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

export default function PaymentSuccessPage() {
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [message, setMessage] = useState('Confirming your subscription...');

  useEffect(() => {
    let cancelled = false;
    async function verify() {
      // Stripe returns here as a FULL page load, so auth is still resolving
      // on the first pass. Returning early without waiting meant the
      // verification call never fired at all.
      if (authLoading) return;
      if (!user || !isAuthenticated) {
        setMessage('Please sign in again so we can confirm your payment.');
        return;
      }
      const sessionId = new URLSearchParams(window.location.search).get('session_id');
      if (!sessionId) { setMessage('This payment link is missing its session.'); return; }
      try {
        const response = await fetch(`/api/payments/verify?session_id=${encodeURIComponent(sessionId)}`, {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        });
        if (!response.ok) throw new Error('verification failed');
        if (!cancelled) router.replace('/home');
      } catch {
        if (!cancelled) setMessage('We could not confirm the payment yet. Please try again shortly.');
      }
    }
    void verify();
    return () => { cancelled = true; };
  }, [authLoading, isAuthenticated, router, user]);

  return <main className="screen" style={{ padding: 24, textAlign: 'center' }}><h1>Almost there</h1><p>{message}</p></main>;
}