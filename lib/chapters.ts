/* Today's chapter — the built-in demo arc, plus the reading-tutor path
 * (skeleton + stage-matched generation via /api/chapters/story with an
 * explicit fallback to the demo arc).
 *
 * One five-page story arc, personalized by the child's top interest: the
 * companion character and scenery change, the phonics shape stays (short
 * sentences, decodable words, one or two focus words per page — mockup:
 * "Only one or two sentences at a time"). Each page lists focus words that
 * get highlighted in the reader and reported to the parent.                  */

import type { ChildProfile, InterestId } from './profile';
import { pickSkeleton, type Skeleton } from '../reading-tutor/src/skeletons';
import { assignSlots } from '../reading-tutor/src/slots';
import type { StoryDraft } from '../reading-tutor/src/validators';

export interface ChapterPage {
  text: string;
  focusWords: string[];
}

export interface Chapter {
  /** Stable per-day identity — the story-art pack is generated once per id
   *  and reused across Home/Reading/Chapter-end (never per render). */
  id: string;
  title: string;
  character: string;
  /** Companion animal/creature, for image-prompt and ambience context. */
  companion: string;
  /** Where the story takes place — feeds both art prompts and ambience. */
  setting: string;
  /** Ambience identity for playStoryAmbience() (see lib/audio.ts). */
  ambience: 'farm' | 'space' | 'jungle' | 'countryside' | 'fantasy' | 'ocean';
  pages: ChapterPage[];
  cliffhanger: [string, string];
  teaser: string;
  phonics: { hint: string; words: string[] }[];
}

const SETTINGS: Record<
  InterestId,
  { character: string; place: string; spot: string; setting: string; ambience: Chapter['ambience'] }
> = {
  dogs: { character: 'Rex', place: 'field', spot: 'gate', setting: 'a sunny countryside farm with wooden fences', ambience: 'farm' },
  space: { character: 'Zip', place: 'sky', spot: 'star', setting: 'a glowing starlit galaxy with soft planets', ambience: 'space' },
  dinosaurs: { character: 'Dot', place: 'swamp', spot: 'rock', setting: 'a lush prehistoric jungle with ferns and mist', ambience: 'jungle' },
  trains: { character: 'Chug', place: 'track', spot: 'bridge', setting: 'rolling countryside hills with a winding rail line', ambience: 'countryside' },
  unicorns: { character: 'Luna', place: 'meadow', spot: 'well', setting: 'an enchanted flowering meadow with soft magical light', ambience: 'fantasy' },
  ocean: { character: 'Finn', place: 'reef', spot: 'shell', setting: 'a sunlit coral reef under calm turquoise water', ambience: 'ocean' },
};

/** Deterministic per-day id: same profile + calendar day → same id, so the
 *  generated visual pack is created once and reused all day instead of
 *  drifting per session or per page load. */
export function chapterIdFor(interest: InterestId | undefined, childName: string): string {
  const day = new Date().toLocaleDateString('en-CA');
  const slug = childName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'reader';
  return `${interest ?? 'dogs'}-${slug}-${day}`;
}

export function chapterFor(interest: InterestId | undefined, childName = 'reader'): Chapter {
  const s = SETTINGS[interest ?? 'dogs'];
  return {
    id: chapterIdFor(interest, childName),
    title: "Today's Chapter",
    character: s.character,
    companion: s.character,
    setting: s.setting,
    ambience: s.ambience,
    pages: [
      { text: `${s.character} raced across the ${s.place}. He saw something shiny under the ${s.spot}.`, focusWords: [s.character, s.spot] },
      { text: 'It was a little gold key. Who lost it?', focusWords: ['gold', 'key'] },
      { text: `${s.character} looked and looked. A tiny path went up the hill.`, focusWords: ['path', 'hill'] },
      { text: 'At the top was a red door. The key fit the lock. Click!', focusWords: ['door', 'lock'] },
      { text: 'The door began to open. Something was inside!', focusWords: ['open', 'inside'] },
    ],
    cliffhanger: ['The door opened... and something amazing was waiting inside.', 'To be continued tomorrow...'],
    teaser: `${s.character} finds out what was behind the door...`,
    phonics: [
      { hint: 'sh in shiny', words: ['shiny'] },
      { hint: 'short vowels', words: ['path', 'fit', 'hill'] },
      { hint: 'blends', words: ['click', 'raced'] },
    ],
  };
}

/* ── Story scenes (client side) ──────────────────────────────────────────
 * IMPORTANT: these are full environmental STORY SCENES for Screens 3-5,
 * distinct from the small interest icons used on Parent Setup
 * (public/images/setup/interest-*.png). Never use a setup icon as a
 * full-screen background — it reads as a stretched app icon, not a scene.
 *
 * Fallback hierarchy actually in effect right now:
 *  1) chapter.visuals.*SceneUrl — AI-generated scene, ONLY used if present
 *     (the automatic generation call is currently disabled at the call
 *     sites in app/home and app/read; see requestChapterVisuals below for
 *     why, and how to re-enable it once OPENAI_API_KEY/Firebase Storage are
 *     configured and verified end-to-end).
 *  2) a curated local story scene from public/images/home/story-scenes/
 *     (add files there — see storySceneUrl below for the expected names).
 *  3) the generic .lc-scenic/.lc-cliff gradient in globals.css, which is
 *     what actually renders today until story-scene image files exist.
 *
 * Selection is deterministic per chapter.id (stable while the child is
 * inside the chapter — never re-randomized on render/refresh).          */

const STORY_SCENE_VARIANTS = 2; // e.g. dogs-01.png, dogs-02.png

function stableHash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic 1-based variant number for this chapter — same chapter.id
 *  always picks the same scene, so it never flickers between renders. */
export function storySceneVariant(chapterId: string): number {
  return (stableHash(chapterId) % STORY_SCENE_VARIANTS) + 1;
}

/** Curated local story-scene path. Files are NOT yet present in the repo —
 *  the <img> consuming this must handle onError (falls through to the CSS
 *  gradient) until real assets are added at this path. */
export function storySceneUrl(interest: InterestId | undefined, variant: number): string {
  const n = String(variant).padStart(2, '0');
  return `/images/home/story-scenes/${interest ?? 'dogs'}-${n}.png`;
}

/* ── Screen 3: real discovered scene assets (2026-08-17 inventory) ───────
 * public/images/home/story-scenes/ has no files yet (storySceneUrl above
 * always misses and falls to the CSS gradient). public/images/landing/ DOES
 * have real, large, portrait story-scene illustrations already — just not
 * named/organized for this use. Inventoried by hand (dimensions + intent),
 * excluding the landing hero photo, the three tiny landing benefit icons,
 * and the setup-icons sprite sheet:
 *   dinosaurs-01.png, dinosaurs-02.png, ocean-01.png,
 *     ocean-02.png, space-01.png, unicorns-01.png.
 * No scene currently exists for dogs/trains — best-effort matching falls
 * through to the general pool for those interests, per product decision. */
const REAL_SCENE_POOL: Partial<Record<InterestId, string[]>> = {
  dinosaurs: ['/images/landing/dinosaurs-01.png', '/images/landing/dinosaurs-02.png'],
  ocean: ['/images/landing/ocean-01.png', '/images/landing/ocean-02.png'],
  space: ['/images/landing/space-01.png'],
  unicorns: ['/images/landing/unicorns-01.png'],
};

/** Interest-aware, best-effort, stable scene selection from the REAL assets
 *  that exist today. Picks the first of the child's interests with a
 *  matching scene; if none match, picks (deterministically) from the whole
 *  curated pool; returns null only if the pool is empty (caller falls back
 *  to the .lc-scenic/.lc-cliff gradient — never to a setup icon). */
export function selectStoryScene(chapterId: string, interests: InterestId[]): string | null {
  const hash = stableHash(chapterId);
  for (const interest of interests) {
    const pool = REAL_SCENE_POOL[interest];
    if (pool?.length) return pool[hash % pool.length];
  }
  const everything = Object.values(REAL_SCENE_POOL).flat();
  return everything.length ? everything[hash % everything.length] : null;
}

export interface ChapterVisuals {
  homeSceneUrl: string;
  readingSceneUrl: string;
  cliffhangerSceneUrl: string;
  generatedAt: number;
  version: 1;
}

const VISUALS_CACHE_PREFIX = 'little-chapters-visuals:';

export function loadCachedVisuals(chapterId: string): ChapterVisuals | null {
  try {
    const raw = JSON.parse(localStorage.getItem(VISUALS_CACHE_PREFIX + chapterId) ?? 'null') as ChapterVisuals | null;
    return raw && typeof raw.homeSceneUrl === 'string' ? raw : null;
  } catch {
    return null;
  }
}

/* ── Reading-tutor story path (skeletons + stage-matched generation) ───── */

function stageForAge(age: number): number {
  return Math.min(10, Math.max(1, Math.round(age) - 4));
}

function stateKey(profile: ChildProfile): string {
  return `little-chapters-story-state:${profile.childName.trim().toLowerCase()}`;
}

function recentSkeletons(profile: ChildProfile): string[] {
  try {
    return JSON.parse(localStorage.getItem(stateKey(profile)) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function rememberSkeleton(profile: ChildProfile, id: string): void {
  try {
    const recent = [id, ...recentSkeletons(profile).filter((item) => item !== id)].slice(0, 4);
    localStorage.setItem(stateKey(profile), JSON.stringify(recent));
  } catch {
    /* best-effort rotation memory */
  }
}

export function tutorStoryContext(profile: ChildProfile): { stage: number; skeleton: Skeleton } {
  const stage = stageForAge(profile.age);
  return { stage, skeleton: pickSkeleton(stage, recentSkeletons(profile)) };
}

export function adaptTutorDraft(
  profile: ChildProfile,
  draft: StoryDraft,
  skeleton: Skeleton,
  slots?: Record<string, string>,
): Chapter | null {
  if (!Array.isArray(draft.sentences) || draft.sentences.length === 0) return null; // a page-less chapter would crash the reader
  const stage = stageForAge(profile.age);
  rememberSkeleton(profile, skeleton.id);
  const base = chapterFor(profile.interests[0], profile.childName);
  // Practice words MUST be the slots the story was actually generated with
  // (returned by the API) — re-rolling assignSlots here would report words
  // the child never read. The re-roll stays only as a last-resort fallback.
  const practiceWords = Object.values(slots ?? assignSlots(skeleton.beats, stage));
  /* Whole-token match, NOT substring: the reader highlights whole tokens
   * (app/read/page.tsx PageText), so a substring hit would claim a focus word
   * that never lights up and never appears in the parent's "new words" — and
   * the palettes are full of collisions ('hat' inside 'that', 'top' inside
   * 'stop', 'pin' inside 'spin'). Tokenizing must mirror the reader exactly. */
  const tokensOf = (sentence: string): Set<string> =>
    new Set(
      sentence
        .split(/\s+/)
        .map((t) => t.replace(/[’ʼ]/g, "'").toLowerCase().replace(/[^a-z0-9']/g, ''))
        .filter(Boolean),
    );
  const focusFor = (sentence: string): string[] => {
    const tokens = tokensOf(sentence);
    return practiceWords.filter((w) => tokens.has(w.toLowerCase())).slice(0, 2);
  };
  return {
    ...base,
    pages: draft.sentences.map((text) => ({ text, focusWords: focusFor(text) })),
    cliffhanger: [draft.sentences.at(-1) ?? skeleton.cliffhangerNote, 'To be continued tomorrow...'],
    teaser: draft.summaryLine || `${profile.childName} has more to discover tomorrow...`,
    phonics: [{ hint: `Stage ${stage} practice`, words: practiceWords }],
  };
}

const TUTOR_CACHE_PREFIX = 'little-chapters-tutor-chapter:';

function loadCachedTutorChapter(id: string): Chapter | null {
  try {
    const raw = JSON.parse(localStorage.getItem(TUTOR_CACHE_PREFIX + id) ?? 'null') as Chapter | null;
    return raw && Array.isArray(raw.pages) && raw.pages.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/* In-flight generations, keyed by chapter id. Every generation is a paid
 * model call, and React StrictMode fires the mount effect twice in dev — so
 * without this, the first load of a day buys the same story twice. */
const inFlight = new Map<string, Promise<Chapter | null>>();

/** One generation per child per day: the tutor chapter is cached under the
 *  same stable per-day id the demo chapter uses, so a mid-day reload reads
 *  the SAME story instead of paying for (and waiting on) a new one. */
export async function requestTutorChapter(profile: ChildProfile, authToken?: string | null): Promise<Chapter | null> {
  // Stage is part of the cache key: same-named profile at a different age
  // must not be served the wrong-stage story for the rest of the day.
  const id = `${chapterIdFor(profile.interests[0], profile.childName)}:s${stageForAge(profile.age)}`;
  const cached = loadCachedTutorChapter(id);
  if (cached) return cached;
  const pending = inFlight.get(id);
  if (pending) return pending;
  const run = generateTutorChapter(profile, id, authToken);
  inFlight.set(id, run);
  try {
    return await run;
  } finally {
    inFlight.delete(id);
  }
}

async function generateTutorChapter(
  profile: ChildProfile,
  id: string,
  authToken?: string | null,
): Promise<Chapter | null> {
  const context = tutorStoryContext(profile);
  try {
    const response = await fetch('/api/chapters/story', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ profile, stage: context.stage, skeletonId: context.skeleton.id }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { draft?: StoryDraft; skeleton?: Skeleton; slots?: Record<string, string> };
    if (!data.draft || !data.skeleton) return null;
    const chapter = adaptTutorDraft(profile, data.draft, data.skeleton, data.slots);
    if (!chapter) return null;
    try {
      localStorage.setItem(TUTOR_CACHE_PREFIX + id, JSON.stringify(chapter));
    } catch {
      /* best-effort cache */
    }
    return chapter;
  } catch {
    return null;
  }
}

function cacheVisuals(chapterId: string, visuals: ChapterVisuals): void {
  try {
    localStorage.setItem(VISUALS_CACHE_PREFIX + chapterId, JSON.stringify(visuals));
  } catch {
    /* best-effort */
  }
}

/** Requests the generated visual pack once per chapter.id. NOT CALLED from
 *  Screen 3/4/5 right now — runtime diagnosis (2026-08-17) proved the
 *  automatic path returns 503 in this environment (OPENAI_API_KEY /
 *  FIREBASE_SERVICE_ACCOUNT / FIREBASE_STORAGE_BUCKET are unset — no
 *  .env.local at all), so the client was silently falling back to a small
 *  setup icon stretched full-screen. Left here, unused by the pages, so the
 *  generated-URL source can be swapped back in later (chapter.visuals.* →
 *  local story scene) without touching the UI once the backend is verified
 *  end-to-end. */
export async function requestChapterVisuals(
  chapter: Chapter,
  profile: ChildProfile,
  authToken: string | null,
): Promise<ChapterVisuals | null> {
  const cached = loadCachedVisuals(chapter.id);
  if (cached) return cached;
  try {
    const res = await fetch('/api/chapters/visuals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ chapterId: chapter.id, chapter, profile }),
    });
    if (!res.ok) return null;
    const { visuals } = (await res.json()) as { visuals: ChapterVisuals };
    if (!visuals?.homeSceneUrl) return null;
    cacheVisuals(chapter.id, visuals);
    return visuals;
  } catch {
    return null; // network hiccup — caller falls back, never blocks reading
  }
}

/** Parent Setup ICON only (small illustration) — never use as a Screen 3-5
 *  full-screen story-scene background. */
export function interestFallbackImage(interest: InterestId | undefined): string {
  return `/images/setup/interest-${interest ?? 'dogs'}.png`;
}
