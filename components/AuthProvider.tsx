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
import { INVALID_PHONE_MESSAGE, normalizePhoneNumber } from '@/lib/phone';

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
  /** A real Firebase error surfaced after the redirect sign-in path
   *  completed — see finishRedirectSignIn. null when there is nothing to
   *  show, or once clearRedirectError() has been called. */
  redirectError: string | null;
  clearRedirectError: () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
  saveParentPhoneNumber: (phoneNumber: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/* Module-level (not React state) auth diagnostics — mirrors lib/audio.ts's
 * _voiceHistory/_lastUtterance pattern. Read by window.__authDebug() below.
 * Exists because the "Google returns to /register with no confirmation"
 * live-production report was, until now, genuinely undiagnosable from the
 * browser: every operation that could fail (linkWithPopup, signInWithPopup,
 * signInWithRedirect, getRedirectResult) either threw into a catch that
 * silently discarded the error, or succeeded/failed with no visible trace.
 * Never records the ID token, credentials, or the phone number. */
interface AuthDiag {
  lastOperation: 'link-popup' | 'signin-popup' | 'redirect' | 'redirect-result' | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  redirectResultFound: boolean | null; // null = getRedirectResult has not been checked yet this page load
  idTokenChangedFired: boolean;
}
let _authDiag: AuthDiag = {
  lastOperation: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  redirectResultFound: null,
  idTokenChangedFired: false,
};

function recordAuthOp(op: AuthDiag['lastOperation']): void {
  _authDiag = { ..._authDiag, lastOperation: op };
}

function recordAuthError(err: unknown): void {
  const code = (err as { code?: string })?.code ?? null;
  const message = err instanceof Error ? err.message : String(err);
  _authDiag = { ..._authDiag, lastErrorCode: code, lastErrorMessage: message };
  console.error('[Auth]', { operation: _authDiag.lastOperation, code, message });
}

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
    recordAuthOp('redirect');
    // Survives the full page reload a redirect causes.
    if (outgoingAnonUid) sessionStorage.setItem(PENDING_ANON_UID, outgoingAnonUid);
    try {
      await signInWithRedirect(auth, provider);
    } catch (err) {
      recordAuthError(err);
      throw err;
    }
  };

  if (current?.isAnonymous) {
    recordAuthOp('link-popup');
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
      if (!recoverable) {
        recordAuthError(err);
        throw err;
      }
      // Linking is impossible: this account already belongs to another user.
      // The activation is spent, so a second popup would be blocked — redirect.
      return redirect();
    }
  }

  recordAuthOp('signin-popup');
  try {
    const cred = await signInWithPopup(auth, provider);
    if (outgoingAnonUid) claimAnonymousChild(cred.user.uid, outgoingAnonUid);
    publish();
  } catch (err) {
    if ((err as { code?: string })?.code === 'auth/popup-blocked') return redirect();
    recordAuthError(err);
    throw err;
  }
}

/** Completes a redirect sign-in after the page reloads.
 *
 *  getRedirectResult() resolves to `null` — never throws — when there is
 *  simply no pending redirect; the `if (!result) return;` line below is
 *  the ENTIRE handling for that ordinary case. The catch block therefore
 *  only ever runs for a REAL Firebase error (account-exists-with-different-
 *  credential, network failure, an expired/invalid pending-redirect state,
 *  etc.) — it used to be discarded silently, which made a genuine failure
 *  after the parent picked their Google account indistinguishable from
 *  "nothing happened" (the exact live-production symptom this fixes):
 *  logged via recordAuthError (visible in window.__authDebug()) and handed
 *  to `onError` so the UI can show the parent something useful, instead of
 *  bouncing them back to a silent /register with no explanation. `publish()`
 *  on success is NOT optional here — see AuthSession's doc comment just
 *  below: onIdTokenChanged usually re-publishes on its own once the token
 *  refresh from this redirect lands, but that is a second, independent
 *  listener with no ordering guarantee relative to this function returning,
 *  and the popup-based sign-in paths above call publish() explicitly rather
 *  than lean on that race — this path was the one place that didn't. */
async function finishRedirectSignIn(
  auth: ReturnType<typeof getFirebaseAuth>,
  publish: () => void,
  onError: (message: string) => void,
): Promise<void> {
  recordAuthOp('redirect-result');
  try {
    const result = await getRedirectResult(auth);
    _authDiag = { ..._authDiag, redirectResultFound: Boolean(result) };
    if (!result) return;
    const pending = sessionStorage.getItem(PENDING_ANON_UID);
    if (pending) {
      claimAnonymousChild(result.user.uid, pending);
      sessionStorage.removeItem(PENDING_ANON_UID);
    }
    publish();
  } catch (err) {
    _authDiag = { ..._authDiag, redirectResultFound: false };
    recordAuthError(err);
    const code = (err as { code?: string })?.code;
    // Cancellation isn't a failure worth alarming a parent over — they just
    // closed the tab/backed out of Google's consent screen.
    if (code === 'auth/cancelled-popup-request' || code === 'auth/user-cancelled') return;
    onError(err instanceof Error ? err.message : 'Sign-in did not complete. Please try again.');
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
  // A REAL Firebase error from the redirect completion (see
  // finishRedirectSignIn) — distinct from configError (Firebase never
  // initialized at all) and from the popup-path errors thrown directly back
  // to the caller (those are still handled by the calling page's own
  // try/catch). This is the one auth failure mode that happens on its own,
  // after a full-page reload, with nothing awaiting it — so it needs its
  // own place to land instead of vanishing into a resolved promise nobody
  // is still listening to.
  const [redirectError, setRedirectError] = useState<string | null>(null);
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

      void finishRedirectSignIn(auth, publish, setRedirectError);

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
        _authDiag = { ..._authDiag, idTokenChangedFired: true };
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
      redirectError,
      clearRedirectError: () => setRedirectError(null),
      async signInWithGoogle() {
        setRedirectError(null); // a fresh attempt should not still show a stale failure
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await upgradeOrSignIn(provider, publish);
      },
      async signInWithApple() {
        setRedirectError(null);
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
        // Local check first, purely so a typo is caught without a round
        // trip. The route re-normalises and is the authority — see
        // lib/phone.ts.
        if (!normalizePhoneNumber(phoneNumber)) throw new Error(INVALID_PHONE_MESSAGE);
        /* Server-mediated on purpose. This used to write parents/{uid}
         * straight from the browser, which needed client write access to a
         * document holding PII under a ruleset that was never deployed —
         * see app/api/parents/phone/route.ts for the full reasoning. */
        const response = await fetch('/api/parents/phone', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${await user.getIdToken()}`,
          },
          body: JSON.stringify({ phoneNumber }),
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || 'Could not save that number. Please try again.');
        }
      },
    }),
    // `session`, not `user` — see the AuthSession note. Depending on `user`
    // would rebuild nothing when the SAME instance is upgraded from
    // anonymous to Google, so isAuthenticated would stay stale even though
    // the component re-rendered.
    [session, user, loading, configError, redirectError, publish],
  );

  /* window.__authDebug() — the auth-side twin of lib/audio.ts's
   * window.__voiceDebug(), same rationale: deliberately NOT gated on
   * NODE_ENV, because `next build` always sets NODE_ENV=production on every
   * Vercel deployment, and this exists specifically to answer "what actually
   * happened after the parent picked their Google account" on the real
   * deployed app, from DevTools, without sandbox/Vercel access. Re-assigned
   * on every render so it always reads the CURRENT configError/redirectError
   * (component state) — _authDiag and the live auth.currentUser lookup are
   * read fresh on each call regardless. Never exposes the ID token,
   * credentials, or the phone number — only uid, isAnonymous, email,
   * provider IDs, and the diagnostic fields listed below. */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as unknown as { __authDebug: () => Record<string, unknown> }).__authDebug = () => {
      let currentUser: User | null = null;
      try {
        currentUser = getFirebaseAuth().currentUser;
      } catch {
        /* Firebase never initialized — configError below already covers this */
      }
      return {
        uid: currentUser?.uid ?? null,
        isAnonymous: currentUser?.isAnonymous ?? null,
        email: currentUser?.email ?? null,
        providerIds: currentUser?.providerData.map((p) => p.providerId) ?? [],
        isAuthenticated: Boolean(currentUser && !currentUser.isAnonymous),
        loading,
        configError,
        redirectError,
        lastOperation: _authDiag.lastOperation,
        lastError: _authDiag.lastErrorCode ? { code: _authDiag.lastErrorCode, message: _authDiag.lastErrorMessage } : null,
        redirectResultFound: _authDiag.redirectResultFound,
        idTokenChangedFired: _authDiag.idTokenChangedFired,
      };
    };
  }, [loading, configError, redirectError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
