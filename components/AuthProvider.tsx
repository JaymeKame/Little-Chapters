'use client';

/* Auth context for Little Chapters with phone number support.
 * Follows the pattern from inzone-games but adapted for phone authentication
 * and parent account creation after free chapter. */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  GoogleAuthProvider,
  OAuthProvider,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase';
import { doc, setDoc, getFirestore } from 'firebase/firestore';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  configError: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
  saveParentPhoneNumber: (phoneNumber: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    let unsub = () => {};
    try {
      const auth = getFirebaseAuth();

      unsub = onAuthStateChanged(auth, async (u) => {
        if (!u) {
          try {
            await signInAnonymously(auth);
          } catch {
            // Ignore transient anonymous sign-in failures; the app can still
            // render without a Firebase identity when the browser is offline.
          }
        }

        setUser(auth.currentUser);
        setLoading(false);
      });
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Firebase init failed');
      setLoading(false);
    }
    return () => unsub();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user && !user.isAnonymous),
      configError,
      async signInWithGoogle() {
        const auth = getFirebaseAuth();
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await signInWithPopup(auth, provider);
      },
      async signInWithApple() {
        const auth = getFirebaseAuth();
        const provider = new OAuthProvider('apple.com');
        provider.addScope('email');
        provider.addScope('name');
        await signInWithPopup(auth, provider);
      },
      async signOut() {
        await fbSignOut(getFirebaseAuth());
      },
      async saveParentPhoneNumber(phoneNumber: string) {
        if (!user) throw new Error('No authenticated user');
        const db = getFirestore();
        await setDoc(doc(db, 'parents', user.uid), {
          phoneNumber,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      },
    }),
    [user, loading, configError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
