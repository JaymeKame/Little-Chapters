'use client';

/* Payment information page for Little-Chapters subscriptions.
 * Allows parents to choose subscription plans and manage their payment methods. */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { PLANS } from '@/lib/stripe';

export default function PaymentPage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const [selectedPlan, setSelectedPlan] = useState<string>('monthly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/register');
      return;
    }
    void (async () => {
      try {
        const token = await user?.getIdToken();
        if (!token) return;
        const response = await fetch('/api/payments/subscription', { headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json() as { subscribed?: boolean };
        if (data.subscribed) router.replace('/home');
      } catch {
        // Checkout remains available if the status check is temporarily unavailable.
      }
    })();
  }, [isAuthenticated, router, user]);

  async function handleSubscribe(planId: string) {
    setLoading(true);
    setError(null);

    try {
      const token = await user?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const response = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ planId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create checkout session');
      }

      // Redirect to Stripe checkout
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout');
    } finally {
      setLoading(false);
    }
  }

  const selectedPlanData = PLANS.find((p) => p.id === selectedPlan);

  return (
    <div className="screen" style={{ padding: '20px', maxWidth: '500px', margin: '0 auto' }}>
      <header style={{ marginBottom: '30px', textAlign: 'center' }}>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: '28px', margin: '0 0 10px' }}>
          Choose Your Plan
        </h1>
        <p style={{ color: 'var(--ink-soft)', fontSize: 14, margin: 0 }}>
          Get daily SMS updates about your child's reading progress
        </p>
      </header>

      {error && (
        <div style={{ padding: '12px', borderRadius: 8, background: '#fee', color: '#c33', fontSize: 14, marginBottom: '20px' }}>
          {error}
        </div>
      )}

      {/* Plan selection */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
        {PLANS.map((plan) => (
          <button
            key={plan.id}
            onClick={() => setSelectedPlan(plan.id)}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderRadius: 12,
              border: `2px solid ${selectedPlan === plan.id ? 'var(--leaf)' : 'var(--line)'}`,
              background: selectedPlan === plan.id ? 'oklch(0.78 0.14 155 / 0.1)' : 'var(--card)',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              transition: 'all 0.2s',
            }}
          >
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: '4px' }}>
                {plan.name}
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                Billed {plan.interval === 'month' ? 'monthly' : 'yearly'}
              </div>
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--leaf)' }}>
              ${(plan.amount / 100).toFixed(2)}
            </div>
          </button>
        ))}
      </div>

      {/* Features */}
      <div style={{ marginBottom: '24px', padding: '16px', background: 'var(--card)', borderRadius: 12, border: '1px solid var(--line)' }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: '12px', margin: 0 }}>
          What you'll get:
        </h3>
        <ul style={{ margin: 0, paddingLeft: '20px', fontSize: 14, lineHeight: 1.6, color: 'var(--ink-2)' }}>
          <li style={{ marginBottom: '8px' }}>Daily SMS with specific wins from each reading session</li>
          <li style={{ marginBottom: '8px' }}>Progress tracking across all chapters</li>
          <li style={{ marginBottom: '8px' }}>In-app message history</li>
          <li style={{ marginBottom: 0 }}>Cancel anytime</li>
        </ul>
      </div>

      {/* Subscribe button */}
      <button
        onClick={() => handleSubscribe(selectedPlan)}
        disabled={loading}
        className="btn-primary"
        style={{
          width: '100%',
          padding: '16px',
          fontSize: 16,
          fontWeight: 600,
          borderRadius: 12,
          border: 0,
          background: 'var(--leaf)',
          color: '#fff',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? 'Processing...' : `Subscribe to ${selectedPlanData?.name} Plan`}
      </button>

      <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-soft)', marginTop: '16px' }}>
        Secure payment powered by Stripe
      </p>

      <button
        onClick={() => router.push('/home')}
        style={{
          width: '100%',
          padding: '12px',
          fontSize: 14,
          marginTop: '12px',
          borderRadius: 12,
          border: 0,
          background: 'transparent',
          color: 'var(--ink-soft)',
          cursor: 'pointer',
        }}
      >
        Maybe Later
      </button>
    </div>
  );
}
