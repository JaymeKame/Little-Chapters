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
import { loadReport } from './profile';
import { loadLocalProgress } from './child-progress';
import { loadPreferenceValues } from './preference-values';
import { initialStage } from '../reading-tutor/src/progression';
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

/* ── Built-in story skeletons (demo/fallback path) ───────────────────────
 * Same design as reading-tutor/src/skeletons.ts: beats fixed, nouns
 * variable, and every arc ends on an INTERRUPTION (unopened / unseen /
 * unfinished) — never a resolution. Unlike the tutor skeletons these are
 * already child-readable sentences, not model instructions, because this
 * path has no model. Slots ({character}/{place}/{spot} from SETTINGS plus
 * per-skeleton pools below) are filled by code, deterministically seeded
 * by chapter.id, so the same day always renders the same story and
 * rotation comes from the date changing.                                 */

interface StorySkeletonPage {
  /** Template with {slot} blanks; 1–2 short sentences once filled. */
  text: string;
  /** Focus-word templates — same tagging contract as before (highlighted
   *  in the reader and reported to the parent). */
  focus: string[];
}

interface StorySkeleton {
  id: string;
  engine: 'unopened' | 'unseen' | 'unfinished';
  /** Per-skeleton noun pools; one word per slot is picked by the seed. */
  slots?: Record<string, string[]>;
  pages: StorySkeletonPage[];
  cliffhanger: [string, string];
  teaser: string;
}

const STORY_SKELETONS: StorySkeleton[] = [
  {
    id: 'the-shiny-thing',
    engine: 'unopened',
    slots: { adj: ['gold', 'old', 'tiny'] },
    pages: [
      { text: '{character} raced across the {place}. Something shiny sat under the {spot}.', focus: ['{character}', '{spot}'] },
      { text: 'It was a little {adj} key. Who lost it?', focus: ['{adj}', 'key'] },
      { text: '{character} looked and looked. A tiny path went up the hill.', focus: ['path', 'hill'] },
      { text: 'At the top was a red door with a lock. The key fit! Click!', focus: ['door', 'lock'] },
      { text: 'The door began to open. Something was inside!', focus: ['open', 'inside'] },
    ],
    cliffhanger: ['The door opened... and something amazing was waiting inside.', 'To be continued tomorrow...'],
    teaser: '{character} finds out what was behind the door...',
  },
  {
    id: 'the-sound-from-the-spot',
    engine: 'unseen',
    slots: { sound: ['tap', 'hum', 'thump'] },
    pages: [
      { text: '{character} sat down by the {spot}. The {place} was still and calm.', focus: ['{character}', 'calm'] },
      { text: 'Then... {sound}, {sound}, {sound}! A soft sound came from the {spot}.', focus: ['{sound}', 'soft'] },
      { text: '{character} kept very still. What could it be?', focus: ['still', 'kept'] },
      { text: 'The {sound} came back. It was big and loud this time!', focus: ['{sound}', 'loud'] },
      { text: 'Something behind the {spot} began to move!', focus: ['behind', 'move'] },
    ],
    cliffhanger: ['Something was moving behind the {spot}... but what?', 'To be continued tomorrow...'],
    teaser: '{character} finds out what was making the {sound}...',
  },
  {
    id: 'the-one-that-follows',
    engine: 'unfinished',
    slots: { shape: ['shadow', 'shape'] },
    pages: [
      { text: '{character} set off across the {place}. The sun was big and bright.', focus: ['sun', 'bright'] },
      { text: 'A small {shape} slid past the {spot}. It kept low.', focus: ['{shape}', '{spot}'] },
      { text: '{character} stopped. The {shape} stopped too.', focus: ['{shape}', 'stopped'] },
      { text: '{character} went fast. The {shape} went fast too!', focus: ['fast', 'went'] },
      { text: 'Then the {shape} said, "Wait for me!"', focus: ['said', 'wait'] },
    ],
    cliffhanger: ['The {shape} could talk... but who was it?', 'To be continued tomorrow...'],
    teaser: '{character} finds out who was following...',
  },
  {
    id: 'the-way-in',
    engine: 'unopened',
    slots: { glow: ['glow', 'shine'] },
    pages: [
      { text: '{character} played by the {spot}. It was a fine day at the {place}.', focus: ['{character}', '{place}'] },
      { text: 'There was a gap by the {spot}. It was not there before!', focus: ['gap', 'before'] },
      { text: '{character} peeked in. It was dim and deep.', focus: ['peeked', 'deep'] },
      { text: 'A soft {glow} lit up far, far inside.', focus: ['{glow}', 'inside'] },
      { text: '{character} took one step in. Then one more!', focus: ['step', 'more'] },
    ],
    cliffhanger: ['One more step... and {character} was all the way in.', 'To be continued tomorrow...'],
    teaser: '{character} finds out what makes the {glow}...',
  },
  {
    id: 'the-left-thing',
    engine: 'unopened',
    slots: { adj: ['red', 'blue', 'small'], thing: ['box', 'tin', 'bag'] },
    pages: [
      { text: '{character} found a {adj} {thing} by the {spot}. It sat there all alone.', focus: ['{adj}', '{thing}'] },
      { text: 'The {thing} was shut tight. A star mark was on top.', focus: ['shut', 'mark'] },
      { text: 'Was it left just for {character}? It had to be!', focus: ['left', 'just'] },
      { text: '{character} tugged at the top. It came up a tiny bit.', focus: ['tugged', 'tiny'] },
      { text: 'A soft light spilled out of the {thing}!', focus: ['light', 'spilled'] },
    ],
    cliffhanger: ['Light spilled from the {thing}... what was inside?', 'To be continued tomorrow...'],
    teaser: '{character} opens the {thing} at last...',
  },
];

function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}

/** Seeded LCG so skeleton + slot picks are stable per chapter.id. */
function stableRandom(seed: string): () => number {
  let value = stableHash(seed);
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

/* ── Phonics tagging (derived, not hard-coded) ───────────────────────────
 * Scans the rendered pages for the same three hint families the old demo
 * chapter reported (digraphs, short vowels, blends), so the parent report
 * always describes the words the child actually read.                    */

const DIGRAPHS = ['sh', 'ch', 'th', 'wh'];
const BLENDS = ['bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'pl', 'pr', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'sw', 'tr', 'tw'];
const PHONICS_STOP_WORDS = new Set([
  'the', 'was', 'and', 'who', 'for', 'one', 'out', 'all', 'are', 'were',
  'there', 'what', 'could', 'this', 'then', 'with', 'said', 'very',
]);

function derivePhonics(pages: ChapterPage[], excludeWords: string[]): Chapter['phonics'] {
  const exclude = new Set(excludeWords.map((w) => w.toLowerCase()));
  const words = [...new Set(pages.flatMap((p) => p.text.toLowerCase().match(/[a-z]+/g) ?? []))]
    .filter((w) => w.length >= 3 && !PHONICS_STOP_WORDS.has(w) && !exclude.has(w));

  const hints: Chapter['phonics'] = [];
  const digraphWords = words.filter((w) => DIGRAPHS.some((d) => w.includes(d)));
  if (digraphWords.length) {
    const d = DIGRAPHS.find((d) => digraphWords[0].includes(d))!;
    hints.push({ hint: `${d} in ${digraphWords[0]}`, words: digraphWords.slice(0, 4) });
  }
  const cvcWords = words.filter((w) => /^[b-df-hj-np-tv-z][aeiou][b-df-hj-np-tv-z]{1,2}$/.test(w));
  if (cvcWords.length) {
    hints.push({ hint: 'short vowels', words: cvcWords.slice(0, 4) });
  }
  const blendWords = words.filter((w) => BLENDS.some((b) => w.startsWith(b)));
  if (blendWords.length) {
    hints.push({ hint: 'blends', words: blendWords.slice(0, 4) });
  }
  return hints.length ? hints : [{ hint: 'story words', words: words.slice(0, 4) }];
}

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
  const id = chapterIdFor(interest, childName);

  // Deterministic per chapter.id: same child + interest + day always renders
  // the same skeleton and the same slot picks (rotation comes from the day).
  const rand = stableRandom(id);
  const skeleton = STORY_SKELETONS[Math.floor(rand() * STORY_SKELETONS.length)];
  const vars: Record<string, string> = {
    character: s.character,
    place: s.place,
    spot: s.spot,
  };
  for (const [slot, pool] of Object.entries(skeleton.slots ?? {})) {
    vars[slot] = pool[Math.floor(rand() * pool.length)];
  }

  const pages = skeleton.pages.map((page) => ({
    text: fillTemplate(page.text, vars),
    focusWords: page.focus.map((word) => fillTemplate(word, vars)),
  }));

  return {
    id,
    title: "Today's Chapter",
    character: s.character,
    companion: s.character,
    setting: s.setting,
    ambience: s.ambience,
    pages,
    cliffhanger: [fillTemplate(skeleton.cliffhanger[0], vars), skeleton.cliffhanger[1]],
    teaser: fillTemplate(skeleton.teaser, vars),
    phonics: derivePhonics(pages, [s.character]),
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
 *  2) lib/scene-selector.ts's selectSceneForPage() against the real curated
 *     manifest in lib/scene-manifest.ts (public/images/scenes/) — see that
 *     file's header for the full selection algorithm.
 *  3) the generic .lc-scenic/.lc-cliff gradient in globals.css, reached only
 *     if a chosen asset's <img> 404s at runtime (SceneBackground's onError).
 *
 * Selection is deterministic per (chapter.id, pageIndex) — stable while the
 * child is on that page, never re-randomized on render/refresh, and now
 * varies BY PAGE within a chapter rather than freezing on one image.     */

/** Small deterministic string hash — still used by chapterFor's own
 *  stableRandom() below and available to other modules that need the same
 *  "same id -> same pick" determinism (e.g. lib/scene-selector.ts's
 *  tie-break). */
export function stableHash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h;
}

/* ── Scene selection now lives in lib/scene-selector.ts ──────────────────
 * selectSceneForPage(chapter, page, pageIndex, avatar, uid) — semantic +
 * character-continuity + recent-avoidance matching against the real,
 * individually-cropped asset manifest in lib/scene-manifest.ts (57 scenes,
 * built 2026-08-21 from the actual supplied artwork — see
 * docs/STORY_IMAGE_SYSTEM.md for the full build record). It replaces this
 * function's old single-tag "one array per interest" pool AND runs per
 * PAGE, not once per chapter, so a multi-page chapter can progress through
 * different (but thematically related) art instead of freezing on one image.
 *
 * The OLD pool below (removed, not just deprioritized) pointed at
 * public/images/landing/{dinosaurs,ocean,space,unicorns}-*.jpg. Inspecting
 * the actual files (not just their names) during the 2026-08-20 image-
 * library audit found every one of them is a landing-page HERO illustration,
 * not a clean scene background: each has "Today's Chapter" baked directly
 * into the art with a character shown physically holding an open book, and
 * dinosaurs-01/02.jpg are both a BEAR reading in a forest with no dinosaur
 * content at all. Those findings still stand and are why this file no
 * longer references them — QUARANTINED, not deleted (nothing else in the
 * repo uses these specific files, but they're left on disk rather than
 * removed as an unforced, unrelated cleanup). Do not re-add them to any
 * selector without re-solving the baked-text/mislabeling problem first. */

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

export function stageForAge(age: number): number {
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

/** Once a ChildProgress record exists for this child (any session has ever
 *  completed), ITS stage is authoritative for generation — never
 *  re-derived from age (see docs/ADAPTIVE_LOOP.md, Phase 1). Age is used
 *  only to seed the very FIRST chapter, through the SAME initialStage()
 *  composition lib/child-progress.ts's defaultProgressFor() already uses
 *  for the progress record itself — so chapter #1 and the child's starting
 *  progress agree from the start, instead of chapter #1 landing one stage
 *  above where progress says the child actually starts.
 *
 *  Synchronous, local-storage-only lookup, deliberately: this matches
 *  every other local-first read in this app (lib/pet.ts, lib/child-
 *  progress.ts) and avoids a network round-trip on every chapter request.
 *  It does not need to be more than that — progress only ever changes at
 *  chapter COMPLETION, never mid-read, and any remote-vs-local reconcile
 *  (see app/read/page.tsx's own progress-loading effect) settles well
 *  before the child's NEXT chapter is requested the following day, when a
 *  fresh chapterId is computed anyway. */
export function resolveGenerationStage(profile: ChildProfile, uid: string | null): number {
  const persisted = loadLocalProgress(uid, profile.childId);
  if (persisted) return persisted.stage;
  const observation = typeof window !== 'undefined' ? loadPreferenceValues().difficultyObservation : 'about-right';
  const adjustment = observation === 'too-easy' ? 1 : observation === 'too-hard' ? -1 : 0;
  // Parent observation only nudges cold-start placement. Once validated
  // ChildProgress exists, the persisted adaptive stage above always wins.
  return initialStage(Math.min(10, Math.max(1, stageForAge(profile.age) + adjustment)));
}

export function tutorStoryContext(profile: ChildProfile, uid: string | null): { stage: number; skeleton: Skeleton } {
  const stage = resolveGenerationStage(profile, uid);
  return { stage, skeleton: pickSkeleton(stage, recentSkeletons(profile)) };
}

export function adaptTutorDraft(
  profile: ChildProfile,
  draft: StoryDraft,
  skeleton: Skeleton,
  slots?: Record<string, string>,
  /** The stage the draft was ACTUALLY generated at (from the same
   *  tutorStoryContext() call that produced it) — passed through rather
   *  than re-derived, so the phonics label below can never disagree with
   *  what the model was actually constrained to. Falls back to the old
   *  age-derived value only for callers that don't have it yet (e.g. this
   *  function's own existing unit tests). */
  stage: number = stageForAge(profile.age),
): Chapter | null {
  if (!Array.isArray(draft.sentences) || draft.sentences.length === 0) return null; // a page-less chapter would crash the reader
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

/** The two existing, already-supported GenerateRequest personalization
 *  inputs this task wires up (see docs/ADAPTIVE_LOOP.md, Phase 2) —
 *  factored out from generateTutorChapter() purely so stage resolution and
 *  context-gathering are independently testable without a network call. */
export function resolveGenerationContext(
  profile: ChildProfile,
  uid: string | null,
): { stage: number; skeleton: Skeleton; recentlyMissedWords: string[]; storySoFar: string } {
  const context = tutorStoryContext(profile, uid);
  // Safe to persist/reuse by construction: this is ChildProgress.trickyWords,
  // which applySession() already computed under every existing invariant —
  // skip/reread-excluded words can never appear here, and a live
  // intervention that was never really a clean read can never have been
  // filtered OUT of it either. Nothing new is inferred here.
  const recentlyMissedWords = loadLocalProgress(uid, profile.childId)?.trickyWords ?? [];
  // "One line summary of the story so far... for tomorrow's context" is
  // GenerateRequest.storySoFar's own documented intent (reading-tutor/src/
  // generate.ts) — draft.summaryLine already flows into Chapter.teaser and
  // is already persisted via SessionReport (lib/profile.ts saveReport/
  // loadReport). This was simply never read back in; wiring it in is
  // closing an already-designed gap, not inventing new state.
  const storySoFar = loadReport()?.teaser ?? '';
  return { ...context, recentlyMissedWords, storySoFar };
}

/** One generation per child per day: the tutor chapter is cached under the
 *  same stable per-day id the demo chapter uses, so a mid-day reload reads
 *  the SAME story instead of paying for (and waiting on) a new one. */
export async function requestTutorChapter(profile: ChildProfile, uid: string | null, authToken?: string | null): Promise<Chapter | null> {
  // Stage is part of the cache key: a child whose progress has moved since
  // yesterday must not be served yesterday's-stage story for the rest of
  // the day (same reasoning as the original age-keyed comment here — the
  // source of the stage changed, not the need to key on it).
  const stage = resolveGenerationStage(profile, uid);
  const id = `${chapterIdFor(profile.interests[0], profile.childName)}:s${stage}`;
  const cached = loadCachedTutorChapter(id);
  if (cached) return cached;
  const pending = inFlight.get(id);
  if (pending) return pending;
  const run = generateTutorChapter(profile, uid, id, authToken);
  inFlight.set(id, run);
  try {
    return await run;
  } finally {
    inFlight.delete(id);
  }
}

async function generateTutorChapter(
  profile: ChildProfile,
  uid: string | null,
  id: string,
  authToken?: string | null,
): Promise<Chapter | null> {
  const context = resolveGenerationContext(profile, uid);
  try {
    const response = await fetch('/api/chapters/story', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        profile,
        stage: context.stage,
        skeletonId: context.skeleton.id,
        recentlyMissedWords: context.recentlyMissedWords,
        storySoFar: context.storySoFar,
      }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { draft?: StoryDraft; skeleton?: Skeleton; slots?: Record<string, string> };
    if (!data.draft || !data.skeleton) return null;
    const chapter = adaptTutorDraft(profile, data.draft, data.skeleton, data.slots, context.stage);
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
