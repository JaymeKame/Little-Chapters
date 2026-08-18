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
  signInWithCustomToken,
  signInWithPopup,
  linkWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase';
import { claimPetFromAnonymousUid } from '@/lib/pet';
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

/* Registering must UPGRADE the anonymous visitor, not replace them.
 * signInWithPopup on an anonymous user issues a brand-new uid and abandons the
 * old one — and everything the child earned is keyed by uid, so Momo's XP and
 * streak vanished at the exact moment the parent signed up. Linking keeps the
 * uid, so nothing has to move. If the Google account was already linked to a
 * different Firebase user, linking is impossible and we fall back to a plain
 * sign-in (that existing account is the one the parent means). */
async function upgradeOrSignIn(provider: GoogleAuthProvider | OAuthProvider): Promise<void> {
  const auth = getFirebaseAuth();
  const current = auth.currentUser;
  const outgoingAnonUid = current?.isAnonymous ? current.uid : null;
  if (current?.isAnonymous) {
    try {
      await linkWithPopup(current, provider);
      return;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      const recoverable =
        code === 'auth/credential-already-in-use' ||
        code === 'auth/email-already-in-use' ||
        code === 'auth/provider-already-linked';
      if (!recoverable) throw err;
    }
  }
  const cred = await signInWithPopup(auth, provider);
  // Linking was impossible (this Google account already belongs to another
  // Firebase user), so the uid changed after all. Carry the pet across, but
  // only into an account that has none — never merge two real histories.
  if (outgoingAnonUid) claimPetFromAnonymousUid(cred.user.uid, outgoingAnonUid);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    let unsub = () => {};
    try {
      const auth = getFirebaseAuth();

      /* Dev-only test hook. Signing in as a real parent needs Google's popup
       * and a human password, which makes the paid flow impossible to drive
       * from a script. This exposes a custom-token sign-in so a minted test
       * parent can exercise checkout end to end. Stripped from production
       * builds by the NODE_ENV guard. */
      if (process.env.NODE_ENV === 'development') {
        (window as unknown as Record<string, unknown>).__lcSignInWithCustomToken =
          (t: string) => signInWithCustomToken(auth, t);
      }

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
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await upgradeOrSignIn(provider);
      },
      async signInWithApple() {
        const provider = new OAuthProvider('apple.com');
        provider.addScope('email');
        provider.addScope('name');
        await upgradeOrSignIn(provider);
      },
      async signOut() {
        await fbSignOut(getFirebaseAuth());
      },
      async saveParentPhoneNumber(phoneNumber: string) {
        if (!user) throw new Error('No authenticated user');
        // Normalize to E.164 — Twilio rejects anything else, and the SMS
        // route validates the stored value before sending.
        const digits = phoneNumber.replace(/[^\d+]/g, '');
        const normalized = digits.startsWith('+')
          ? `+${digits.slice(1).replace(/\D/g, '')}`
          : digits.length === 10
            ? `+1${digits}` // bare 10 digits: assume US/Canada
            : `+${digits}`;
        if (!/^\+[1-9]\d{6,14}$/.test(normalized)) {
          throw new Error('Please enter a valid phone number, like +1 555 123 4567');
        }
        const db = getFirestore();
        await setDoc(doc(db, 'parents', user.uid), {
          phoneNumber: normalized,
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
