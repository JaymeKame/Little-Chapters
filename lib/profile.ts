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

export interface ChildProfile {
  childName: string;
  age: number;
  interests: InterestId[];
  avatar?: AvatarId;
  createdAt: number;
}

const KEY = 'little-chapters-profile';

export function loadProfile(): ChildProfile | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ChildProfile> | null;
    if (!raw || typeof raw.childName !== 'string' || !raw.childName.trim() || !Array.isArray(raw.interests)) {
      return null;
    }
    return {
      childName: raw.childName.slice(0, 40),
      age: typeof raw.age === 'number' && Number.isFinite(raw.age) ? Math.min(12, Math.max(3, Math.round(raw.age))) : 6,
      interests: raw.interests.filter((i): i is InterestId => INTERESTS.some((x) => x.id === i)).slice(0, 3),
      avatar: AVATARS.some((a) => a.id === raw.avatar) ? (raw.avatar as AvatarId) : undefined,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    };
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

/* ── Last-session report for the parent message screen ─────────────────── */

export interface SessionReport {
  date: string; // YYYY-MM-DD
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
