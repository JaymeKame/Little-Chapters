/* Child profile from parent setup — localStorage only for now (the mockup's
 * onboarding has no account creation; "feels like the beginning of a story,
 * not a signup"). */

export const INTERESTS = [
  { id: 'dogs', label: 'Dogs', emoji: '🐶' },
  { id: 'space', label: 'Space', emoji: '🚀' },
  { id: 'dinosaurs', label: 'Dinosaurs', emoji: '🦖' },
  { id: 'trains', label: 'Trains', emoji: '🚂' },
  { id: 'unicorns', label: 'Unicorns', emoji: '🦄' },
  { id: 'ocean', label: 'Ocean', emoji: '🐋' },
] as const;

export type InterestId = (typeof INTERESTS)[number]['id'];

export const AVATARS = [
  { id: 'boy', label: 'Boy', emoji: '👦' },
  { id: 'girl', label: 'Girl', emoji: '👧' },
] as const;

export type AvatarId = (typeof AVATARS)[number]['id'];

export function avatarEmoji(id: AvatarId | undefined): string {
  return AVATARS.find((a) => a.id === id)?.emoji ?? '🧒';
}

/** Illustrated avatar asset — null only when no avatar has been chosen yet
 *  (avatar is optional at setup), in which case callers fall back to the
 *  emoji above. */
export function avatarImageSrc(id: AvatarId | undefined): string | null {
  return id ? `/images/setup/avatar-${id}.png` : null;
}

export function interestImageSrc(id: InterestId): string {
  return `/images/setup/interest-${id}.png`;
}

/** CSS object-position for the avatar image inside its circular frame.
 *  Per-avatar because the source art isn't framed consistently: the boy
 *  portrait is centered with even headroom, but the girl portrait's hair
 *  bun sits right at the top edge of the canvas — a centered crop (the
 *  default 50% 50%) clips into it. Shifting the visible window up (lower
 *  Y%) keeps the bun fully in frame without touching the source asset. */
export function avatarImageObjectPosition(id: AvatarId | undefined): string {
  return id === 'girl' ? '50% 18%' : '50% 50%';
}

export interface ChildProfile {
  /** Stable, opaque identity for this child — generated once at setup, never
   *  derived from the name (names collide and are mutable; see
   *  docs/PERSISTENCE.md for why this is the Firestore partition key under
   *  the owning parent's uid, not childName). */
  childId: string;
  childName: string;
  age: number;
  interests: InterestId[];
  avatar?: AvatarId;
  createdAt: number;
}

const KEY = 'little-chapters-profile';

export function newChildId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `child-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadProfile(): ChildProfile | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ChildProfile> | null;
    if (!raw || typeof raw.childName !== 'string' || !raw.childName.trim() || !Array.isArray(raw.interests)) {
      return null;
    }
    // Backfill: profiles saved before childId existed get one generated once,
    // here, and persisted immediately so it's stable on every later load —
    // never re-derived (a fresh UUID on every load would silently orphan
    // that child's progress/session history each time).
    const childId = typeof raw.childId === 'string' && raw.childId ? raw.childId : newChildId();
    const profile: ChildProfile = {
      childId,
      childName: raw.childName.slice(0, 40),
      age: typeof raw.age === 'number' && Number.isFinite(raw.age) ? Math.min(12, Math.max(3, Math.round(raw.age))) : 6,
      interests: raw.interests.filter((i): i is InterestId => INTERESTS.some((x) => x.id === i)).slice(0, 3),
      avatar: AVATARS.some((a) => a.id === raw.avatar) ? (raw.avatar as AvatarId) : undefined,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    };
    if (childId !== raw.childId) saveProfile(profile);
    return profile;
  } catch {
    return null;
  }
}

export function saveProfile(p: ChildProfile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* best-effort */
  }
}

/* ── Server mirror (best-effort; see docs/PERSISTENCE.md-style rationale in
 * lib/profile-store-admin.ts for why this is server-mediated) ──────────
 *
 * The local profile above is a single global localStorage key — not even
 * uid-scoped — which is exactly right for the account-free onboarding, but
 * means a returning subscriber on a NEW browser/device (or one who cleared
 * site data) has NO profile at all client-side. app/home and app/read call
 * fetchRemoteProfile() as a fallback ONLY when loadProfile() returns null
 * and the caller is a real signed-in uid, so a known returning subscriber
 * is restored instead of being routed through Setup like a brand-new
 * visitor. */

/** Best-effort load from the server mirror. Never throws — callers that
 *  have no token, are offline, or hit an unconfigured Admin SDK are
 *  already fully correct falling back to "no profile found" (genuinely new
 *  visitor) in that case. */
export async function fetchRemoteProfile(idToken: string): Promise<ChildProfile | null> {
  try {
    const res = await fetch('/api/profile', { headers: { Authorization: `Bearer ${idToken}` } });
    if (!res.ok) return null;
    const data = (await res.json()) as { profile?: ChildProfile | null };
    return data.profile ?? null;
  } catch {
    return null;
  }
}

/** Fire-and-forget mirror of the current local profile to the server.
 *  Never blocks the caller and never surfaces a failure — the local copy
 *  is already fully correct on its own device; this only helps a FUTURE
 *  device recognize the same returning subscriber. */
export function mirrorProfileRemote(idToken: string, profile: ChildProfile): void {
  void fetch('/api/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ profile }),
  }).catch(() => {
    /* best-effort mirror — the local copy already has everything this device needs */
  });
}

/* ── Last-session report for the parent message screen ─────────────────── */

export interface SessionReport {
  date: string; // YYYY-MM-DD
  /** Ties the report to the specific chapter it came from (lib/chapters.ts
   *  chapterIdFor) — lets /home tell "today's chapter" apart from "today's
   *  chapter, already read" instead of just checking the date. */
  chapterId: string;
  childName: string;
  newWords: string[];
  practiced: { word: string; hint: string }[];
  teaser: string;
}

const REPORT_KEY = 'little-chapters-last-report';

export function loadReport(): SessionReport | null {
  try {
    const raw = JSON.parse(localStorage.getItem(REPORT_KEY) ?? 'null') as SessionReport | null;
    return raw && typeof raw.date === 'string' && Array.isArray(raw.newWords) ? raw : null;
  } catch {
    return null;
  }
}

export function saveReport(r: SessionReport): void {
  try {
    localStorage.setItem(REPORT_KEY, JSON.stringify(r));
  } catch {
    /* best-effort */
  }
}
