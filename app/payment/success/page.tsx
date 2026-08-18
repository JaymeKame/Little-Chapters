'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

export default function PaymentSuccessPage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const [message, setMessage] = useState('Confirming your subscription...');

  useEffect(() => {
    let cancelled = false;
    async function verify() {
      if (!user || !isAuthenticated) return;
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
  }, [isAuthenticated, router, user]);

  return <main className="screen" style={{ padding: 24, textAlign: 'center' }}><h1>Almost there</h1><p>{message}</p></main>;
}