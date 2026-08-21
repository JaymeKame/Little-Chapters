/* Chapter completion history — the record of which chapters a child has
 * actually finished, so /home can tell "today's chapter" apart from "today's
 * chapter, already read today" instead of always showing the play button.
 *
 * Same shape of tradeoff as lib/pet.ts: localStorage is the always-working
 * store (a child may not be signed in, and ParentMessages' Firestore history
 * only exists for a REGISTERED parent — an anonymous visitor currently gets
 * no history at all). Firestore `readingHistory/{uid}` is mirrored
 * best-effort for signed-in users so history follows them across devices.
 * Firestore writes need a rule deployed for this collection — until then
 * they fail silently and localStorage carries the state, exactly like the
 * readingPets mirror. */

import type { SessionReport } from './profile';

export type ChapterHistoryEntry = SessionReport;

const MAX_ENTRIES = 30; // a month of chapters is plenty for the parent screen

/* Per-user keys: on a shared family device each sibling (and the signed-out
 * "anon" slot) gets their own history — see the identical note in pet.ts. */
const lsKey = (uid: string | null) => `little-chapters-history:${uid ?? 'anon'}`;

function normalize(raw: unknown): ChapterHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<ChapterHistoryEntry>;
  if (
    typeof r.date !== 'string' ||
    typeof r.chapterId !== 'string' ||
    typeof r.childName !== 'string' ||
    !Array.isArray(r.newWords) ||
    !Array.isArray(r.practiced)
  ) {
    return null;
  }
  return {
    date: r.date,
    chapterId: r.chapterId,
    childName: r.childName.slice(0, 40),
    newWords: r.newWords.filter((w): w is string => typeof w === 'string').slice(0, 20),
    practiced: r.practiced
      .filter((p): p is { word: string; hint: string } => !!p && typeof p.word === 'string' && typeof p.hint === 'string')
      .slice(0, 10),
    teaser: typeof r.teaser === 'string' ? r.teaser : '',
  };
}

function loadLocal(uid: string | null): ChapterHistoryEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(lsKey(uid)) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map(normalize).filter((e): e is ChapterHistoryEntry => e !== null);
  } catch {
    return [];
  }
}

function saveLocal(uid: string | null, entries: ChapterHistoryEntry[]): void {
  try {
    localStorage.setItem(lsKey(uid), JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* private mode / quota — localStorage is best-effort too */
  }
}

/* Mirror stays OFF until a readingHistory rule is deployed — see the
 * MIRROR_TO_FIRESTORE note in lib/pet.ts for why this must be an explicit
 * flag rather than an `if (!uid)` check now that every visitor is signed in
 * anonymously by default. */
const MIRROR_TO_FIRESTORE = process.env.NEXT_PUBLIC_READING_HISTORY_SYNC === '1';

/** Local history first — synchronous, so /home can gate its render on the
 *  very first paint instead of flashing the play button before a Firestore
 *  read resolves. */
export function loadChapterHistoryLocal(uid: string | null): ChapterHistoryEntry[] {
  return loadLocal(uid);
}

/** Local history, reconciled with the Firestore mirror when available —
 *  merged by chapterId (Firestore wins on conflict, since it's the
 *  cross-device copy), newest first, capped at MAX_ENTRIES. */
export async function loadChapterHistory(uid: string | null): Promise<ChapterHistoryEntry[]> {
  const local = loadLocal(uid);
  if (!uid || !MIRROR_TO_FIRESTORE) return local;
  try {
    const [{ collection, getDocs, query, orderBy, limit }, { getDb }] = await Promise.all([
      import('firebase/firestore'),
      import('./firebase'),
    ]);
    const snap = await getDocs(query(collection(getDb(), 'readingHistory', uid, 'entries'), orderBy('date', 'desc'), limit(MAX_ENTRIES)));
    const remote = snap.docs.map((d) => normalize(d.data())).filter((e): e is ChapterHistoryEntry => e !== null);
    const byId = new Map(local.map((e) => [e.chapterId, e]));
    for (const e of remote) byId.set(e.chapterId, e); // remote wins — it's the merged cross-device copy
    return [...byId.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, MAX_ENTRIES);
  } catch {
    return local; // offline / rules not deployed yet — local carries the state
  }
}

/** Records a completed chapter. Idempotent per chapterId — a duplicate call
 *  for the same chapter (e.g. a retry after a network blip) replaces rather
 *  than double-counts. */
export function appendChapterHistoryEntry(uid: string | null, entry: ChapterHistoryEntry): void {
  const existing = loadLocal(uid).filter((e) => e.chapterId !== entry.chapterId);
  saveLocal(uid, [entry, ...existing]);
  if (!uid || !MIRROR_TO_FIRESTORE) return;
  void (async () => {
    try {
      const [{ doc, setDoc }, { getDb }] = await Promise.all([import('firebase/firestore'), import('./firebase')]);
      await setDoc(doc(getDb(), 'readingHistory', uid, 'entries', entry.chapterId), entry, { merge: true });
    } catch {
      /* offline / rules not deployed yet — localStorage already has it */
    }
  })();
}

/** Moves an anonymous visitor's history onto the uid they just signed in as
 *  — same contract as claimPetFromAnonymousUid/claimChildProgressFrom-
 *  AnonymousUid (best-effort, local-only, never overwrites a destination
 *  that already has its own history). Called from AuthProvider's
 *  claimAnonymousChild; see the note there for why the FREE-CHAPTER gate
 *  depends on this and not just the parent screen. */
export function claimChapterHistoryFromAnonymousUid(uid: string, anonymousUid: string): void {
  if (!uid || !anonymousUid || uid === anonymousUid) return;
  try {
    if (loadLocal(uid).length) return; // destination already owned
    const carried = loadLocal(anonymousUid);
    if (!carried.length) return;
    saveLocal(uid, carried);
    localStorage.removeItem(lsKey(anonymousUid));
  } catch {
    /* best-effort, same as every other claim in this app */
  }
}

/** Was THIS specific chapter already completed? Synchronous/local-only on
 *  purpose — /home needs this on first paint, before any Firestore round
 *  trip could resolve, and the local copy is always at least as fresh as
 *  Firestore for the completion that just happened on this device. */
export function wasChapterCompleted(uid: string | null, chapterId: string): boolean {
  return loadLocal(uid).some((e) => e.chapterId === chapterId);
}
