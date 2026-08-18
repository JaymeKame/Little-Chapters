'use client';

/* Parent account registration page with Google/Apple sign-in AND phone number.
 * Follows the pattern from inzone-games but requires both authentication
 * and phone number for SMS notifications after the free chapter experience. */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

export default function RegisterPage() {
  const router = useRouter();
  const { user, signInWithGoogle, signInWithApple, saveParentPhoneNumber } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [busy, setBusy] = useState<'google' | 'apple' | 'submit' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Redirect if already authenticated
  useEffect(() => {
    if (user) {
      router.push('/home');
    }
  }, [user, router]);

  async function handleProvider(provider: 'google' | 'apple') {
    setError(null);
    setBusy(provider);
    try {
      if (provider === 'google') await signInWithGoogle();
      else await signInWithApple();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sign-in failed.';
      if (!msg.includes('popup-closed-by-user')) setError(msg);
    } finally {
      setBusy(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy('submit');

    try {
      // Basic phone number validation
      const cleanedPhone = phoneNumber.replace(/\D/g, '');
      if (cleanedPhone.length < 10) {
        throw new Error('Please enter a valid phone number');
      }

      // Save phone number to Firestore
      await saveParentPhoneNumber(phoneNumber);

      // Redirect to payment setup after successful registration
      router.push('/payment');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="screen" style={{ padding: '20px', maxWidth: '400px', margin: '0 auto' }}>
      <header style={{ marginBottom: '30px', textAlign: 'center' }}>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: '28px', margin: '0 0 10px' }}>
          Create Your Account
        </h1>
        <p style={{ color: 'var(--ink-soft)', fontSize: '14', margin: 0 }}>
          Sign in to get daily progress updates via SMS
        </p>
      </header>

      {error && (
        <div style={{ padding: '12px', borderRadius: '8', background: '#fee', color: '#c33', fontSize: '14', marginBottom: '20px' }}>
          {error}
        </div>
      )}

      {/* Google and Apple sign-in buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
        <button
          onClick={() => handleProvider('google')}
          disabled={!!busy}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            padding: '14px',
            fontSize: '15',
            fontWeight: 500,
            borderRadius: '12',
            border: '1.5px solid var(--line)',
            background: '#fff',
            color: 'var(--ink)',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.32A9 9 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M3.97 10.72A5.42 5.42 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.32z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.32C4.68 5.16 6.66 3.58 9 3.58z" />
          </svg>
          {busy === 'google' ? 'Signing in...' : 'Continue with Google'}
        </button>

        <button
          onClick={() => handleProvider('apple')}
          disabled={!!busy}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            padding: '14px',
            fontSize: '15',
            fontWeight: 500,
            borderRadius: '12',
            border: '1.5px solid var(--line)',
            background: '#fff',
            color: 'var(--ink)',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
            <path d="M17.564 12.747c-.027-2.748 2.244-4.07 2.347-4.135-1.279-1.87-3.27-2.128-3.978-2.158-1.692-.171-3.305 1-4.166 1-.876 0-2.188-.975-3.598-.948-1.852.027-3.56 1.075-4.51 2.733-1.92 3.327-.49 8.252 1.385 10.953.917 1.319 2.01 2.8 3.444 2.747 1.385-.056 1.91-.896 3.585-.896 1.673 0 2.146.896 3.612.868 1.494-.028 2.44-1.343 3.355-2.668 1.058-1.531 1.494-3.014 1.521-3.092-.034-.014-2.918-1.119-2.997-4.404zM14.85 4.835c.762-.93 1.279-2.21 1.137-3.49-1.097.046-2.443.732-3.235 1.65-.71.81-1.336 2.114-1.17 3.37 1.226.09 2.486-.61 3.268-1.53z" />
          </svg>
          {busy === 'apple' ? 'Signing in...' : 'Continue with Apple'}
        </button>
      </div>

      {/* Phone number form (required) */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '14', fontWeight: 600, marginBottom: '8px' }}>
            Phone Number <span style={{ color: 'var(--leaf)' }}>*</span>
          </label>
          <input
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="(555) 123-4567"
            required
            style={{
              width: '100%',
              padding: '13px 14px',
              fontSize: '16',
              borderRadius: '12',
              border: '1.5px solid var(--line)',
              background: 'var(--card)',
              outline: 'none',
            }}
            disabled={busy === 'submit'}
          />
          <p style={{ fontSize: '12', color: 'var(--ink-soft)', marginTop: '6px' }}>
            We'll send you one specific win after each reading session
          </p>
        </div>

        <button
          type="submit"
          className="btn-primary"
          disabled={busy === 'submit' || !phoneNumber.trim()}
          style={{
            padding: '14px',
            fontSize: '16',
            fontWeight: 600,
            borderRadius: '12',
            border: 0,
            background: 'var(--leaf)',
            color: '#fff',
            cursor: busy === 'submit' || !phoneNumber.trim() ? 'not-allowed' : 'pointer',
            opacity: busy === 'submit' || !phoneNumber.trim() ? 0.6 : 1,
          }}
        >
          {busy === 'submit' ? 'Creating Account...' : 'Continue to Payment'}
        </button>
      </form>

      <p style={{ textAlign: 'center', fontSize: '12', color: 'var(--ink-soft)', marginTop: '24px' }}>
        By continuing, you agree to receive SMS messages about your child's reading progress.
      </p>
    </div>
  );
}
