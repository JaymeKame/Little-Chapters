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
  signInWithCredential,
  signInWithCustomToken,
  signInWithPopup,
  linkWithPopup,
  signOut as fbSignOut,
  updateProfile,
  type AuthError,
  type User,
} from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase';
import { claimPetFromAnonymousUid } from '@/lib/pet';
import { claimChildProgressFromAnonymousUid } from '@/lib/child-progress';
import { claimChapterHistoryFromAnonymousUid } from '@/lib/chapter-history';
import { loadProfile, mirrorProfileRemote } from '@/lib/profile';
import { INVALID_PHONE_MESSAGE, normalizePhoneNumber } from '@/lib/phone';

/** Claims everything keyed by the outgoing anonymous uid into the new uid —
 *  pet state (existing) and reading progress/session history (this task).
 *  See lib/child-progress.ts's claimChildProgressFromAnonymousUid for why
 *  this is local-only for now (PHASE 6's flagged limitation).
 *
 *  Chapter history moves too, and not only so the parent screen keeps its
 *  entries: it is what records the free demo chapter as spent
 *  (lib/entitlement.ts). Leaving it behind on the abandoned anonymous uid
 *  handed every parent who signed into an existing account (see
 *  recoverExistingAccount below) a fresh free chapter. */
function claimAnonymousChild(newUid: string, oldAnonUid: string): void {
  claimPetFromAnonymousUid(newUid, oldAnonUid);
  claimChapterHistoryFromAnonymousUid(newUid, oldAnonUid);
  const profile = loadProfile();
  if (profile) claimChildProgressFromAnonymousUid(newUid, oldAnonUid, profile.childId);
}

/** Mirrors the browser's local child profile to whichever uid the parent
 *  just became, immediately as part of THIS auth transition — not
 *  deferred to a later /home or /read visit the way the mirror used to be
 *  triggered. A parent who links or recovers an account and then closes
 *  the tab before ever reaching /home (e.g. abandoning partway through the
 *  payment funnel) previously left no server-side profile record at all;
 *  a second device signed into the same account would find nothing and be
 *  routed to /setup, silently losing the child's identity and history
 *  despite the parent having genuinely registered. loadProfile() reads the
 *  SAME single, non-uid-scoped local key the anonymous session already
 *  had, so this mirrors the existing child — it never creates a new one.
 *  Fire-and-forget by design (mirrorProfileRemote() never throws): this
 *  must never block or fail the sign-in it rides along with. */
function mirrorLocalProfile(user: User): void {
  const profile = loadProfile();
  if (!profile) return;
  void user
    .getIdToken()
    .then((token) => mirrorProfileRemote(token, profile))
    .catch(() => {
      /* best-effort — the next /home or /read visit still mirrors it too */
    });
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

/* Module-level (not React state) auth diagnostics — mirrors lib/audio.ts's
 * _voiceHistory/_lastUtterance pattern. Read by window.__authDebug() below.
 * Exists because the "Google returns to /register with no confirmation"
 * live-production report was, until now, genuinely undiagnosable from the
 * browser: every operation that could fail (linkWithPopup, signInWithPopup,
 * the old signInWithRedirect/getRedirectResult) either threw into a catch
 * that silently discarded the error, or succeeded/failed with no visible
 * trace. Never records the ID token, credentials, or the phone number. */
interface AuthDiag {
  lastOperation: 'link-popup' | 'signin-popup' | 'credential-recovery' | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  idTokenChangedFired: boolean;
}
let _authDiag: AuthDiag = {
  lastOperation: null,
  lastErrorCode: null,
  lastErrorMessage: null,
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
 * different Firebase user, linking is impossible — recoverExistingAccount()
 * below signs into that existing account instead (that account is the one
 * the parent means). */

/** Firebase attaches the pending OAuth credential directly to the error for
 *  auth/credential-already-in-use — and sometimes for the other two
 *  "recoverable" codes — specifically so the caller can finish signing in
 *  WITHOUT a second popup. See
 *  https://firebase.google.com/docs/auth/web/account-linking. */
function credentialFromLinkError(provider: GoogleAuthProvider | OAuthProvider, err: unknown) {
  const authErr = err as AuthError;
  return provider instanceof GoogleAuthProvider
    ? GoogleAuthProvider.credentialFromError(authErr)
    : OAuthProvider.credentialFromError(authErr);
}

/** linkWithPopup failed because this Google account already belongs to a
 *  DIFFERENT, existing Firebase user — signs into THAT account instead,
 *  migrating the anonymous child's progress onto it. This app is hosted on
 *  Vercel while Firebase Auth's authDomain is a separate origin; Firebase's
 *  own docs describe signInWithRedirect as unreliable for exactly this
 *  hosting shape on Safari 16.1+, Firefox 109+, and modern Chrome (blocked
 *  third-party/cross-origin storage) — the redirect fallback this function
 *  replaces was the live-production failure this task exists to fix
 *  (redirectResultFound stayed false; the redirect never actually
 *  completed). Popup-based recovery avoids that origin mismatch entirely:
 *  credential-based sign-in needs no popup or redirect at all, and even the
 *  one-more-popup fallback below stays on the SAME origin/tab the parent is
 *  already looking at. */
async function recoverExistingAccount(
  auth: ReturnType<typeof getFirebaseAuth>,
  linkErr: unknown,
  provider: GoogleAuthProvider | OAuthProvider,
  outgoingAnonUid: string | null,
  publish: () => void,
): Promise<void> {
  recordAuthOp('credential-recovery');
  const credential = credentialFromLinkError(provider, linkErr);

  if (credential) {
    try {
      const cred = await signInWithCredential(auth, credential);
      if (outgoingAnonUid) claimAnonymousChild(cred.user.uid, outgoingAnonUid);
      mirrorLocalProfile(cred.user);
      publish();
      return;
    } catch (err) {
      recordAuthError(err);
      throw err;
    }
  }

  // No credential attached to the error (rare — Firebase didn't provide one
  // for this particular recoverable code). A plain signInWithPopup still
  // resolves this correctly: it is not a LINK, just an ordinary sign-in,
  // and Google will hand back the same existing account. It genuinely needs
  // a popup, and — unlike the redirect fallback this replaces — either
  // succeeds or fails within the SAME tap: no ordering-unsafe reload to
  // reconcile state after. If the browser blocks it too, this throws
  // auth/popup-blocked, which the calling page already turns into a clear
  // "allow pop-ups and try again" message — never a silent redirect.
  recordAuthOp('signin-popup');
  try {
    const cred = await signInWithPopup(auth, provider);
    if (outgoingAnonUid) claimAnonymousChild(cred.user.uid, outgoingAnonUid);
    mirrorLocalProfile(cred.user);
    publish();
  } catch (err) {
    recordAuthError(err);
    throw err;
  }
}

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

  if (current?.isAnonymous) {
    recordAuthOp('link-popup');
    try {
      await linkWithPopup(current, provider);
      mirrorLocalProfile(current);
      publish();
      return;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      const recoverable =
        code === 'auth/credential-already-in-use' ||
        code === 'auth/email-already-in-use' ||
        code === 'auth/provider-already-linked';
      if (recoverable) {
        return recoverExistingAccount(auth, err, provider, outgoingAnonUid, publish);
      }
      // Anything else (popup blocked, popup closed, network failure, …) is
      // surfaced as-is — the calling page already has specific copy for the
      // common codes (auth/popup-blocked, auth/network-request-failed) and
      // a generic fallback for the rest. No redirect: see the doc comment
      // on recoverExistingAccount for why that path is unreliable on this
      // hosting shape regardless of which failure triggered it.
      recordAuthError(err);
      throw err;
    }
  }

  recordAuthOp('signin-popup');
  try {
    const cred = await signInWithPopup(auth, provider);
    if (outgoingAnonUid) claimAnonymousChild(cred.user.uid, outgoingAnonUid);
    mirrorLocalProfile(cred.user);
    publish();
  } catch (err) {
    recordAuthError(err);
    throw err;
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
    [session, user, loading, configError, publish],
  );

  /* window.__authDebug() — the auth-side twin of lib/audio.ts's
   * window.__voiceDebug(), same rationale: deliberately NOT gated on
   * NODE_ENV, because `next build` always sets NODE_ENV=production on every
   * Vercel deployment, and this exists specifically to answer "what actually
   * happened after the parent picked their Google account" on the real
   * deployed app, from DevTools, without sandbox/Vercel access. Re-assigned
   * on every render so it always reads the CURRENT configError (component
   * state) — _authDiag and the live auth.currentUser lookup are
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
        lastOperation: _authDiag.lastOperation,
        lastError: _authDiag.lastErrorCode ? { code: _authDiag.lastErrorCode, message: _authDiag.lastErrorMessage } : null,
        idTokenChangedFired: _authDiag.idTokenChangedFired,
      };
    };
  }, [loading, configError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
