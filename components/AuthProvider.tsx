'use client';

/* Minimal auth context: Little Chapters has no sign-in screens yet (the
 * mockup's flow is anonymous-first), but the reading API routes accept a
 * Firebase ID token when a user exists, so keep the plumbing. */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut as fbSignOut, type User } from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsub = () => {};
    try {
      unsub = onAuthStateChanged(getFirebaseAuth(), (u) => {
        setUser(u);
        setLoading(false);
      });
    } catch {
      // Firebase not configured (fresh clone without .env.local) — the app
      // still works fully anonymously.
      setLoading(false);
    }
    return () => unsub();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      async signOut() {
        await fbSignOut(getFirebaseAuth());
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
