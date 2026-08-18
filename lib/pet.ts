/* Momo the reading pet — companion state for the kids' reading app.
 *
 * Pure game logic (XP, levels, growth stages, daily goal, streaks, messages)
 * plus persistence. localStorage is the always-working store (kids may not be
 * signed in); Firestore `readingPets/{uid}` is mirrored best-effort for
 * signed-in users so progress follows them across devices. Firestore writes
 * need the readingPets rule from firestore.phase2b.rules deployed — until
 * then they fail silently and localStorage carries the state.
 *
 * All date handling uses the LOCAL calendar day (a kid's "today" is bedtime-
 * to-bedtime, not UTC).                                                      */

export interface PetState {
  version: 1;
  name: string;
  xp: number;
  totalReadings: number;
  perfectReadings: number;
  /** Readings per day that count as "today's goal". */
  dailyGoal: number;
  readingsToday: number;
  /** Local YYYY-MM-DD of the last counted reading; '' before first ever. */
  lastActiveDay: string;
  /** Consecutive days with ≥1 reading, as of lastActiveDay. */
  streakDays: number;
  bestStreak: number;
  updatedAt: number;
}

export function defaultPetState(): PetState {
  return {
    version: 1,
    name: 'Momo',
    xp: 0,
    totalReadings: 0,
    perfectReadings: 0,
    dailyGoal: 3,
    readingsToday: 0,
    lastActiveDay: '',
    streakDays: 0,
    bestStreak: 0,
    updatedAt: 0,
  };
}

/* ── Levels & growth stages ────────────────────────────────────────────── */

/** XP needed to go from `level` to `level + 1` (gentle early, slower later). */
export function xpForNextLevel(level: number): number {
  return 100 + level * 50;
}

export function levelForXp(xp: number): number {
  let level = 0;
  let remaining = xp;
  while (remaining >= xpForNextLevel(level) && level < 99) {
    remaining -= xpForNextLevel(level);
    level += 1;
  }
  return level;
}

/** XP progress within the current level: [gained, needed]. */
export function levelProgress(xp: number): [number, number] {
  let level = 0;
  let remaining = xp;
  while (remaining >= xpForNextLevel(level) && level < 99) {
    remaining -= xpForNextLevel(level);
    level += 1;
  }
  return [remaining, xpForNextLevel(level)];
}

export interface PetStage {
  minLevel: number;
  emoji: string;
  label: string;
}

export const PET_STAGES: PetStage[] = [
  { minLevel: 0, emoji: '🥚', label: 'Sleepy egg' },
  { minLevel: 1, emoji: '🐣', label: 'Hatchling' },
  { minLevel: 3, emoji: '🐥', label: 'Fluffy chick' },
  { minLevel: 6, emoji: '🦉', label: 'Little owl' },
  { minLevel: 10, emoji: '🦉⭐', label: 'Story owl' },
  { minLevel: 15, emoji: '🦉👑', label: 'Wise owl' },
];

export function stageForLevel(level: number): PetStage {
  let stage = PET_STAGES[0];
  for (const s of PET_STAGES) if (level >= s.minLevel) stage = s;
  return stage;
}

/* ── XP awards ─────────────────────────────────────────────────────────── */

export interface ReadingOutcome {
  /** Azure accuracy 0–100 for the passage. */
  accuracy: number;
  /** Reference words in the passage. */
  wordCount: number;
  /** Words the hybrid grader flagged (incl. omissions). */
  flaggedCount: number;
}

export interface XpAward {
  xp: number;
  perfect: boolean;
}

/** XP for one completed reading. Always rewarding (a struggling reader still
 *  earns), extra for clean accurate passages — capped so grinding one tiny
 *  sentence stays less efficient than reading real passages. */
export function awardForReading(o: ReadingOutcome): XpAward {
  const cleanWords = Math.max(0, o.wordCount - o.flaggedCount);
  let xp = 10 + Math.min(15, cleanWords);
  if (o.accuracy >= 90) xp += 10;
  else if (o.accuracy >= 75) xp += 5;
  const perfect = o.flaggedCount === 0 && o.accuracy >= 85 && o.wordCount >= 3;
  if (perfect) xp += 15;
  return { xp: Math.min(60, xp), perfect };
}

/* ── Days & streaks ────────────────────────────────────────────────────── */

/** Local calendar day as YYYY-MM-DD. */
export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function yesterdayKey(today: string): string {
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return todayKey(dt);
}

/** Days between two YYYY-MM-DD keys (b - a), local-safe. */
export function daysBetween(a: string, b: string): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86_400_000);
}

/** The streak to DISPLAY right now: broken (0) once a full day was missed. */
export function currentStreak(state: PetState, today: string = todayKey()): number {
  if (!state.lastActiveDay) return 0;
  return daysBetween(state.lastActiveDay, today) <= 1 ? state.streakDays : 0;
}

/** Fold one completed reading into the state (pure). */
export function applyReading(state: PetState, award: XpAward, today: string = todayKey()): PetState {
  // Gap-based so a lastActiveDay in the FUTURE (clock fix, westward travel)
  // counts as "same day" instead of nuking the streak; lastActiveDay is
  // clamped back to today below, so the state self-heals in one reading.
  const gap = daysBetween(state.lastActiveDay, today);
  const sameDay = gap <= 0;
  const continued = gap === 1;
  const streakDays = sameDay ? state.streakDays : continued ? state.streakDays + 1 : 1;
  return {
    ...state,
    xp: state.xp + award.xp,
    totalReadings: state.totalReadings + 1,
    perfectReadings: state.perfectReadings + (award.perfect ? 1 : 0),
    readingsToday: (sameDay ? state.readingsToday : 0) + 1,
    lastActiveDay: today,
    streakDays,
    bestStreak: Math.max(state.bestStreak, streakDays),
    updatedAt: Date.now(),
  };
}

/* ── Messages ──────────────────────────────────────────────────────────── */

export type PetMood = 'happy' | 'excited' | 'sleepy' | 'longing';

export interface PetMessage {
  text: string;
  mood: PetMood;
}

/** What Momo says when the child opens the page. */
export function greetingFor(state: PetState, today: string = todayKey()): PetMessage {
  if (!state.lastActiveDay) {
    return { text: "Hi, I'm Momo! Read to me and help me hatch! 🌱", mood: 'sleepy' };
  }
  const gap = daysBetween(state.lastActiveDay, today);
  if (gap >= 4) return { text: 'I missed you SO much! Read with me again? 🥺', mood: 'longing' };
  if (gap >= 2) return { text: "You're back!! I was waiting for you! Let's read!", mood: 'excited' };
  if (gap === 1) {
    const streak = state.streakDays;
    return streak >= 2
      ? { text: `Welcome back! Day ${streak + 1} of our streak — let's keep it going! 🔥`, mood: 'excited' }
      : { text: "Welcome back! Ready for today's stories?", mood: 'happy' };
  }
  const left = state.dailyGoal - state.readingsToday;
  return left > 0
    ? { text: `${left} more reading${left === 1 ? '' : 's'} and today's goal is done! 💪`, mood: 'happy' }
    : { text: "Today's goal is done — you're AMAZING! ⭐", mood: 'excited' };
}

/** What Momo says right after a reading is scored. */
export function reactionFor(award: XpAward, flaggedCount: number, leveledUp: boolean): PetMessage {
  if (leveledUp) return { text: 'WOW! I grew bigger! Thank you!! 🎉', mood: 'excited' };
  if (award.perfect) return { text: 'PERFECT reading! You read every word! ⭐', mood: 'excited' };
  if (flaggedCount === 0) return { text: 'Yummy words! That was great!', mood: 'happy' };
  if (flaggedCount === 1) return { text: "So good! Let's try that tricky word together!", mood: 'happy' };
  return { text: "Nice reading! Let's practice the tricky ones — I'll help!", mood: 'happy' };
}

/* ── Persistence ───────────────────────────────────────────────────────── */

/* Per-user keys: on a shared family device each sibling (and the signed-out
 * "anon" slot) gets their own pet — a fixed key would let account A's local
 * copy shadow and then overwrite account B's progress. */
const lsKey = (uid: string | null) => `little-chapters-pet:${uid ?? 'anon'}`;

function normalize(raw: unknown): PetState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<PetState>;
  if (typeof r.xp !== 'number' || typeof r.lastActiveDay !== 'string') return null;
  // Coerce every field: corrupt/hostile stored data must never crash the UI
  // (Array.from({length: dailyGoal}) with a huge/NaN goal) or poison saves.
  const int = (v: unknown, fallback: number, max = 1_000_000_000): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : fallback;
  const d = defaultPetState();
  return {
    version: 1,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.slice(0, 40) : d.name,
    xp: int(r.xp, 0),
    totalReadings: int(r.totalReadings, 0),
    perfectReadings: int(r.perfectReadings, 0),
    dailyGoal: Math.max(1, int(r.dailyGoal, d.dailyGoal, 10)),
    readingsToday: int(r.readingsToday, 0, 1000),
    lastActiveDay: /^\d{4}-\d{2}-\d{2}$/.test(r.lastActiveDay) ? r.lastActiveDay : '',
    streakDays: int(r.streakDays, 0, 100_000),
    bestStreak: int(r.bestStreak, 0, 100_000),
    updatedAt: int(r.updatedAt, 0),
  };
}

function loadLocal(uid: string | null): PetState | null {
  try {
    return normalize(JSON.parse(localStorage.getItem(lsKey(uid)) ?? 'null'));
  } catch {
    return null;
  }
}

function saveLocal(uid: string | null, state: PetState): void {
  try {
    localStorage.setItem(lsKey(uid), JSON.stringify(state));
  } catch {
    /* private mode / quota — localStorage is best-effort too */
  }
}

/* The Firestore mirror stays OFF until the readingPets rule is deployed.
 * It used to be gated by `if (!uid) return`, which worked only while nobody
 * was ever signed in; AuthProvider now signs every visitor in anonymously, so
 * that check stopped gating anything and this became a live write channel for
 * children's reading data under a ruleset that was deliberately never
 * deployed. Flip the flag in the same change that deploys the rule. */
const MIRROR_TO_FIRESTORE = process.env.NEXT_PUBLIC_READING_PETS_SYNC === '1';

/* Claim-once migration. The pet is keyed by uid, and the uid moves under the
 * app's feet: null -> anonymous on first load, and anonymous -> real if the
 * parent registers without linking. Without this, Momo silently resets to an
 * egg at both hops. Only ever claims the signed-out "anon" slot, only when the
 * destination is empty, and removes the source — so a sibling's pet on a
 * shared device is never absorbed. */
function claimAnonPet(uid: string): PetState | null {
  try {
    if (localStorage.getItem(lsKey(uid))) return null; // destination already owned
    const orphan = normalize(JSON.parse(localStorage.getItem(lsKey(null)) ?? 'null'));
    if (!orphan) return null;
    localStorage.setItem(lsKey(uid), JSON.stringify(orphan));
    localStorage.removeItem(lsKey(null));
    return orphan;
  } catch {
    return null;
  }
}

/** Load the pet: localStorage first, then Firestore when signed in — the
 *  copy with the newer updatedAt wins (simple cross-device resolution). */
export async function loadPetState(uid: string | null): Promise<PetState> {
  const local = loadLocal(uid) ?? (uid ? claimAnonPet(uid) : null);
  if (!uid) return local ?? defaultPetState();
  if (!MIRROR_TO_FIRESTORE) return local ?? defaultPetState();
  try {
    const [{ doc, getDoc }, { getDb }] = await Promise.all([import('firebase/firestore'), import('./firebase')]);
    const snap = await getDoc(doc(getDb(), 'readingPets', uid));
    const remote = snap.exists() ? normalize(snap.data()) : null;
    if (remote && (!local || remote.updatedAt >= local.updatedAt)) return remote;
  } catch {
    /* offline / rules not deployed yet — local carries the state */
  }
  return local ?? defaultPetState();
}

export function savePetState(uid: string | null, state: PetState): void {
  saveLocal(uid, state);
  if (!uid || !MIRROR_TO_FIRESTORE) return;
  void (async () => {
    try {
      const [{ doc, setDoc }, { getDb }] = await Promise.all([import('firebase/firestore'), import('./firebase')]);
      await setDoc(doc(getDb(), 'readingPets', uid), state, { merge: true });
    } catch {
      /* offline / rules not deployed yet — localStorage already has it */
    }
  })();
}
