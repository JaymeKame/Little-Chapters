'use client';

/* Auth context for Little Chapters with phone number support.
 * Follows the pattern from inzone-games but adapted for phone authentication
 * and parent account creation after free chapter. */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  GoogleAuthProvider,
  OAuthProvider,
  onIdTokenChanged,
  signInAnonymously,
  signInWithCustomToken,
  signInWithPopup,
  linkWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase';
import { claimPetFromAnonymousUid } from '@/lib/pet';
import { claimChildProgressFromAnonymousUid } from '@/lib/child-progress';
import { claimChapterHistoryFromAnonymousUid } from '@/lib/chapter-history';
import { loadProfile } from '@/lib/profile';
import { doc, setDoc, getFirestore } from 'firebase/firestore';

/** Claims everything keyed by the outgoing anonymous uid into the new uid —
 *  pet state (existing) and reading progress/session history (this task).
 *  See lib/child-progress.ts's claimChildProgressFromAnonymousUid for why
 *  this is local-only for now (PHASE 6's flagged limitation).
 *
 *  Chapter history moves too, and not only so the parent screen keeps its
 *  entries: it is what records the free demo chapter as spent
 *  (lib/entitlement.ts). Leaving it behind on the abandoned anonymous uid
 *  handed every parent who signed in via the redirect path a fresh free
 *  chapter. */
function claimAnonymousChild(newUid: string, oldAnonUid: string): void {
  claimPetFromAnonymousUid(newUid, oldAnonUid);
  claimChapterHistoryFromAnonymousUid(newUid, oldAnonUid);
  const profile = loadProfile();
  if (profile) claimChildProgressFromAnonymousUid(newUid, oldAnonUid, profile.childId);
}

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
const PENDING_ANON_UID = 'little-chapters-pending-anon-uid';

async function upgradeOrSignIn(
  provider: GoogleAuthProvider | OAuthProvider,
  /* Republishes auth into React once the provider flow lands. Firebase's own
   * notification is enough (see the onIdTokenChanged note below), but this
   * whole feature was broken for want of a re-render, so the success paths
   * say so explicitly rather than relying on SDK internals. */
  publish: () => void,
): Promise<void> {
  const auth = getFirebaseAuth();
  const current = auth.currentUser;
  const outgoingAnonUid = current?.isAnonymous ? current.uid : null;

  /* A popup may only be opened while the browser still considers the click
   * "user-activated" — which expires at the first await. So exactly ONE popup
   * call is allowed per tap, and anything after it must redirect instead.
   * Getting this wrong blocked the popup at the Create-Free-Account moment. */
  const redirect = async () => {
    // Survives the full page reload a redirect causes.
    if (outgoingAnonUid) sessionStorage.setItem(PENDING_ANON_UID, outgoingAnonUid);
    await signInWithRedirect(auth, provider);
  };

  if (current?.isAnonymous) {
    try {
      await linkWithPopup(current, provider);
      // A link that succeeded means no redirect is coming; a stale marker
      // here would otherwise make the NEXT sign-in claim a dead uid.
      sessionStorage.removeItem(PENDING_ANON_UID);
      publish();
      return;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        return redirect();
      }
      const recoverable =
        code === 'auth/credential-already-in-use' ||
        code === 'auth/email-already-in-use' ||
        code === 'auth/provider-already-linked';
      if (!recoverable) throw err;
      // Linking is impossible: this account already belongs to another user.
      // The activation is spent, so a second popup would be blocked — redirect.
      return redirect();
    }
  }

  try {
    const cred = await signInWithPopup(auth, provider);
    if (outgoingAnonUid) claimAnonymousChild(cred.user.uid, outgoingAnonUid);
    publish();
  } catch (err) {
    if ((err as { code?: string })?.code === 'auth/popup-blocked') return redirect();
    throw err;
  }
}

/** Completes a redirect sign-in after the page reloads. */
async function finishRedirectSignIn(auth: ReturnType<typeof getFirebaseAuth>): Promise<void> {
  try {
    const result = await getRedirectResult(auth);
    if (!result) return;
    const pending = sessionStorage.getItem(PENDING_ANON_UID);
    if (pending) {
      claimAnonymousChild(result.user.uid, pending);
      sessionStorage.removeItem(PENDING_ANON_UID);
    }
  } catch {
    /* nothing pending, or the redirect was abandoned */
  }
}

/* Why the user is boxed in an object rather than held directly:
 *
 * linkWithPopup UPGRADES the anonymous user in place — same uid, same User
 * INSTANCE, mutated (isAnonymous flips to false). So `setUser(currentUser)`
 * hands React the identical reference it already has, React bails out of the
 * render by Object.is, and the tree never learns the parent signed in. A
 * fresh wrapper per publish gives React something that has actually
 * changed. */
interface AuthSession {
  user: User | null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession>({ user: null });
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const user = session.user;

  const publish = useCallback(() => {
    try {
      setSession({ user: getFirebaseAuth().currentUser });
    } catch {
      /* config error already surfaced by the effect below */
    }
  }, []);

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

      void finishRedirectSignIn(auth);

      /* onIdTokenChanged, NOT onAuthStateChanged. The auth-state listener is
       * gated on the UID CHANGING (notifyAuthListeners compares
       * lastNotifiedUid before calling authStateSubscription), and the whole
       * point of the linkWithPopup path above is that the uid does NOT
       * change. So a successful Google sign-in never fired the listener,
       * setUser never ran, isAuthenticated stayed false, and the parent saw
       * a page that had visibly not reacted to them signing in — with
       * /payment bouncing them straight back to /register. The id-token
       * listener fires on the token refresh that linking produces. */
      unsub = onIdTokenChanged(auth, async (u) => {
        if (!u) {
          try {
            await signInAnonymously(auth);
          } catch {
            // Ignore transient anonymous sign-in failures; the app can still
            // render without a Firebase identity when the browser is offline.
          }
        }

        publish();
        setLoading(false);
      });
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Firebase init failed');
      setLoading(false);
    }
    return () => unsub();
  }, [publish]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user && !user.isAnonymous),
      configError,
      async signInWithGoogle() {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await upgradeOrSignIn(provider, publish);
      },
      async signInWithApple() {
        const provider = new OAuthProvider('apple.com');
        provider.addScope('email');
        provider.addScope('name');
        await upgradeOrSignIn(provider, publish);
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
    // `session`, not `user` — see the AuthSession note. Depending on `user`
    // would rebuild nothing when the SAME instance is upgraded from
    // anonymous to Google, so isAuthenticated would stay stale even though
    // the component re-rendered.
    [session, user, loading, configError, publish],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
