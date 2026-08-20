/* Reading-session persistence + ChildProgress load/create/update.
 *
 * Same shape of tradeoff as lib/pet.ts and lib/chapter-history.ts:
 * localStorage is the always-working store (a child may not be signed in,
 * or the Admin SDK may not be configured in this environment); the server
 * (via /api/progress/*, Firebase Admin) is a best-effort mirror for
 * signed-in users so progress follows them across devices. Unlike pet.ts's
 * Firestore mirror, the server side here is NOT gated behind a client
 * feature flag: it never uses the client Firestore SDK at all (see
 * docs/PERSISTENCE.md) — every read/write is server-mediated through an API
 * route that verifies the caller's Firebase ID token and derives ownership
 * from the verified uid, never from client-supplied data. That sidesteps
 * the shared project's undeployed/unscoped rules problem entirely (Admin
 * SDK writes are not subject to Firestore security rules), so there is
 * nothing here waiting on a rule deployment the way readingPets is.
 *
 * The one thing this file guarantees on its own, with no network: a chapter
 * completed twice (double-tap, retried request) applies progression exactly
 * once. See completeSessionPure()/completeSessionLocally() below — the
 * ledger of already-completed chapterIds is the whole mechanism, deliberately
 * simple. The server route (app/api/progress/complete-session/route.ts)
 * re-implements the identical idempotency check against Firestore, using a
 * transaction, so the guarantee holds across devices too, not just locally. */

import type { ChildProgress, SessionInput, SessionReading } from '../reading-tutor/src/types';
import {
  initialStage,
  applySession,
  toPersistable as progressToPersistable,
} from '../reading-tutor/src/progression';
import { toPersistable as sessionToPersistable } from '../reading-tutor/src/interpret';
import {
  interpretSessionWithIntervention,
  type SessionIntervention,
} from './reading-session-interpreter';

export type PersistableProgress = ReturnType<typeof progressToPersistable>;
export type PersistableSession = ReturnType<typeof sessionToPersistable> & {
  childId: string;
  chapterId: string;
  startedAt: string;
  completedAt: string;
};

/** A brand-new child needs a starting stage before any session exists.
 *
 * Age is the only signal setup collects today (see docs/PERSISTENCE.md —
 * this mapping is intentionally simple and documented rather than invented
 * pedagogy): lib/chapters.ts's stageForAge(age) gives a coarse age-based
 * estimate, then reading-tutor's own initialStage() (deliberately one stage
 * below that estimate — "the cost of starting too easy is one slightly dull
 * evening; the cost of starting too hard is a child who decides reading is
 * not for them") turns it into the seed stage. Once a ChildProgress exists,
 * THIS is never called again for that child — stage comes from the
 * persisted progress, not freshly from age. */
export function defaultProgressFor(childId: string, ageDerivedStageEstimate: number): ChildProgress {
  return {
    childId,
    stage: initialStage(ageDerivedStageEstimate),
    sessionsCompleted: 0,
    mode: 'placement',
    recentAccuracy: [],
    consecutiveLow: 0,
    trickyWords: [],
  };
}

function toPersistableSession(
  reading: SessionReading,
  session: SessionInput,
  completedAt: string,
): PersistableSession {
  return {
    ...sessionToPersistable(reading),
    childId: session.childId,
    chapterId: session.chapterId,
    startedAt: session.startedAt,
    completedAt,
  };
}

/** The pure decision at the heart of PHASE 4/5's idempotency requirement:
 *  given whether this chapterId was already completed, either apply
 *  progression once (first completion) or don't (repeat completion) — never
 *  branch on anything else, and never partially apply. No I/O: the caller
 *  supplies `alreadyCompleted` and persists whatever comes back. */
export function completeSessionPure(opts: {
  progress: ChildProgress;
  alreadyCompleted: boolean;
  sessionInput: SessionInput;
  interventions: SessionIntervention;
  previouslyTricky?: string[];
  now?: string;
}): { reading: SessionReading; nextProgress: ChildProgress; applied: boolean; persistedSession: PersistableSession } {
  const reading = interpretSessionWithIntervention(
    opts.sessionInput,
    opts.interventions,
    undefined,
    opts.previouslyTricky ?? [],
  );
  const completedAt = opts.now ?? new Date().toISOString();
  const persistedSession = toPersistableSession(reading, opts.sessionInput, completedAt);

  if (opts.alreadyCompleted) {
    // Repeat completion (double-tap, retried request): the session record is
    // safe to re-write (it's the same content, keyed by chapterId — see
    // markLocalSessionCompleted), but progression must not run again.
    return { reading, nextProgress: opts.progress, applied: false, persistedSession };
  }

  const { progress: nextProgress } = applySession(opts.progress, reading);
  return { reading, nextProgress, applied: true, persistedSession };
}

/* ── localStorage I/O (always-working store) ──────────────────────────── */

const progressKey = (uid: string | null, childId: string) => `little-chapters-progress:${uid ?? 'anon'}:${childId}`;
const sessionsKey = (uid: string | null, childId: string) => `little-chapters-sessions:${uid ?? 'anon'}:${childId}`;

export function normalizeProgress(raw: unknown): ChildProgress | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<ChildProgress> & { _windowInternal?: unknown };
  if (typeof r.childId !== 'string' || typeof r.stage !== 'number') return null;
  const int = (v: unknown, fallback: number, max = 1_000_000) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : fallback;
  const window = Array.isArray(r.recentAccuracy)
    ? r.recentAccuracy.filter((a): a is number => typeof a === 'number')
    : Array.isArray((r as Record<string, unknown>)._windowInternal)
      ? ((r as Record<string, unknown>)._windowInternal as unknown[]).filter((a): a is number => typeof a === 'number')
      : [];
  return {
    childId: r.childId,
    stage: int(r.stage, 1, 10),
    sessionsCompleted: int(r.sessionsCompleted, 0),
    mode: r.mode === 'steady' ? 'steady' : 'placement',
    recentAccuracy: window,
    consecutiveLow: int(r.consecutiveLow, 0, 1000),
    trickyWords: Array.isArray(r.trickyWords) ? r.trickyWords.filter((w): w is string => typeof w === 'string') : [],
  };
}

export function loadLocalProgress(uid: string | null, childId: string): ChildProgress | null {
  try {
    return normalizeProgress(JSON.parse(localStorage.getItem(progressKey(uid, childId)) ?? 'null'));
  } catch {
    return null;
  }
}

export function saveLocalProgress(uid: string | null, childId: string, progress: ChildProgress): void {
  try {
    localStorage.setItem(progressKey(uid, childId), JSON.stringify(progress));
  } catch {
    /* private mode / quota — best-effort, same as every other local store here */
  }
}

function loadLedger(uid: string | null, childId: string): Record<string, PersistableSession> {
  try {
    const raw = JSON.parse(localStorage.getItem(sessionsKey(uid, childId)) ?? '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function saveLedgerEntry(uid: string | null, childId: string, entry: PersistableSession): void {
  try {
    const ledger = loadLedger(uid, childId);
    ledger[entry.chapterId] = entry;
    localStorage.setItem(sessionsKey(uid, childId), JSON.stringify(ledger));
  } catch {
    /* best-effort */
  }
}

/** Whether this exact chapter's session has already been completed and had
 *  progression applied, for THIS child, on THIS store. The one fact
 *  idempotency is built on. */
export function wasSessionCompleted(uid: string | null, childId: string, chapterId: string): boolean {
  return chapterId in loadLedger(uid, childId);
}

/** Full local completion: idempotent, synchronous, no network — this is
 *  what makes "completing the same chapter twice doesn't double-apply
 *  progression" true even fully offline. Always safe to call more than once
 *  with the same sessionInput.chapterId. */
export function completeSessionLocally(
  uid: string | null,
  childId: string,
  ageDerivedStageEstimate: number,
  sessionInput: SessionInput,
  interventions: SessionIntervention,
  previouslyTricky: string[] = [],
): { reading: SessionReading; progress: ChildProgress; applied: boolean } {
  const existingProgress = loadLocalProgress(uid, childId) ?? defaultProgressFor(childId, ageDerivedStageEstimate);
  const alreadyCompleted = wasSessionCompleted(uid, childId, sessionInput.chapterId);

  const { reading, nextProgress, applied, persistedSession } = completeSessionPure({
    progress: existingProgress,
    alreadyCompleted,
    sessionInput,
    interventions,
    previouslyTricky,
  });

  if (applied) saveLocalProgress(uid, childId, nextProgress);
  saveLedgerEntry(uid, childId, persistedSession); // safe to re-write on a repeat call — same content

  return { reading, progress: nextProgress, applied };
}

/* ── Claim-once migration (anonymous uid -> real uid after linking fails) ─
 * Mirrors lib/pet.ts's claimPetFromAnonymousUid exactly, including the
 * non-merge, empty-destination-only, source-removed invariants — see that
 * file's comment for the full reasoning. In the common case (linkWithPopup
 * succeeds), the uid never changes, so this never runs at all. */

export function claimChildProgressFromAnonymousUid(uid: string, anonymousUid: string, childId: string): void {
  if (!uid || !anonymousUid || uid === anonymousUid) return;
  try {
    if (localStorage.getItem(progressKey(uid, childId))) return; // destination already owned
    const progressRaw = localStorage.getItem(progressKey(anonymousUid, childId));
    const sessionsRaw = localStorage.getItem(sessionsKey(anonymousUid, childId));
    if (progressRaw) {
      localStorage.setItem(progressKey(uid, childId), progressRaw);
      localStorage.removeItem(progressKey(anonymousUid, childId));
    }
    if (sessionsRaw) {
      localStorage.setItem(sessionsKey(uid, childId), sessionsRaw);
      localStorage.removeItem(sessionsKey(anonymousUid, childId));
    }
  } catch {
    /* best-effort, same as every other claim in this app */
  }
}

/* ── Server mirror (best-effort; see docs/PERSISTENCE.md for why this is
 * server-mediated rather than a direct client Firestore write) ─────────── */

export interface RemoteProgress {
  progress: PersistableProgress;
  created: boolean;
}

/** Best-effort load-or-create against the server. Never throws — callers
 *  that only have the local copy available (no token, offline, admin not
 *  configured) are already fully correct without this. */
export async function fetchRemoteProgress(
  idToken: string,
  childId: string,
  ageDerivedStageEstimate: number,
): Promise<RemoteProgress | null> {
  try {
    const res = await fetch(`/api/progress/child?childId=${encodeURIComponent(childId)}&estimatedStage=${ageDerivedStageEstimate}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as RemoteProgress;
  } catch {
    return null;
  }
}

/** Best-effort mirror of a completed session to the server. Fire-and-forget
 *  from the caller's point of view — PHASE 4 explicitly says not to block
 *  the chapter-end screen on this. The server independently re-derives and
 *  re-checks idempotency; it never trusts a client-computed SessionReading. */
export async function completeSessionRemote(
  idToken: string,
  childId: string,
  ageDerivedStageEstimate: number,
  sessionInput: SessionInput,
  interventions: SessionIntervention,
  previouslyTricky: string[] = [],
): Promise<{ progress: PersistableProgress; applied: boolean } | null> {
  try {
    const res = await fetch('/api/progress/complete-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ childId, ageDerivedStageEstimate, sessionInput, interventions, previouslyTricky }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { progress: PersistableProgress; applied: boolean };
  } catch {
    return null;
  }
}

/** Reconciles local + remote by sessionsCompleted (a strictly-increasing
 *  counter — the same "whichever moved further wins" idea as pet.ts's
 *  updatedAt merge, but using the field that actually matters here). Saves
 *  the winner back locally so the next load is fast and offline-safe. */
export function reconcileProgress(uid: string | null, childId: string, local: ChildProgress, remote: PersistableProgress | null): ChildProgress {
  if (!remote) return local;
  if (remote.sessionsCompleted <= local.sessionsCompleted) return local;
  const merged: ChildProgress = {
    childId,
    stage: remote.stage,
    sessionsCompleted: remote.sessionsCompleted,
    mode: remote.mode,
    recentAccuracy: remote._windowInternal,
    consecutiveLow: remote.consecutiveLow,
    trickyWords: remote.trickyWords,
  };
  saveLocalProgress(uid, childId, merged);
  return merged;
}
