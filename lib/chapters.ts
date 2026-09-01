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
import { pickSkeleton, SKELETONS, type Skeleton } from '../reading-tutor/src/skeletons';
import { assignSlots } from '../reading-tutor/src/slots';
import type { StoryDraft } from '../reading-tutor/src/validators';
import { fallbackBlueprintForChapter, type StoryBlueprint } from './story-blueprint.ts';
import type { StoryGenerationDiagnostic } from './story-generator.server';
import { chapterIdForDay, isValidDay, todayLocal } from './chapter-id';

export interface ChapterPage {
  text: string;
  focusWords: string[];
  semanticBeatId?: string;
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
  /** Complete, validated causal plan authored before the session starts. */
  storyBlueprint?: StoryBlueprint;
  provenance?: ChapterProvenance;
}

export type ChapterSource = 'generated' | 'cached-generated' | 'fallback' | 'demo/static';
export interface ChapterProvenance { source: ChapterSource; generatedAt?: string; failureReason?: string; entitlementSource?: 'free' | 'subscription'; generationDiagnostic?: StoryGenerationDiagnostic; sessionDay?: string; qaDayRequested?: string | null; qaDayAuthorized?: string | null; storyReadyTiming?: { canonicalRequestMs?: number; persistenceMs?: number; totalServerMs?: number } }

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
 *  drifting per session or per page load. Delegates to lib/chapter-id.ts
 *  (a pure, zero-dependency module) so the server persistence route
 *  (app/api/chapters/today/route.ts) can compute the exact same id from
 *  the exact same (client-supplied) day string without importing this
 *  file, which touches localStorage in several other exports. */
export function chapterIdFor(interest: InterestId | undefined, childName: string): string {
  return chapterIdForDay(interest, childName, todayLocal());
}

export function chapterFor(interest: InterestId | undefined, childName = 'reader'): Chapter {
  return chapterForDay(interest, childName, todayLocal());
}

export function chapterForDay(interest: InterestId | undefined, childName = 'reader', day: string): Chapter {
  const s = SETTINGS[interest ?? 'dogs'];
  const id = chapterIdForDay(interest, childName, day);

  // Deterministic per chapter.id: same child + interest + day always renders
  // the same skeleton and the same slot picks (rotation comes from the day).
  const rand = stableRandom(id);
  const skeleton = STORY_SKELETONS[Math.floor(rand() * STORY_SKELETONS.length)];
  const vars: Record<string, string> = {
    character: childName,
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

  const chapter: Chapter = {
    id,
    title: "Today's Chapter",
    character: childName,
    companion: 'a new story friend',
    setting: s.setting,
    ambience: s.ambience,
    pages,
    cliffhanger: [fillTemplate(skeleton.cliffhanger[0], vars), skeleton.cliffhanger[1]],
    teaser: fillTemplate(skeleton.teaser, vars),
    phonics: derivePhonics(pages, [childName]),
    provenance: { source: 'demo/static' },
  };
  chapter.storyBlueprint = fallbackBlueprintForChapter({ protagonist: chapter.character, companion: chapter.companion, setting: chapter.setting, pages: chapter.pages });
  return chapter;
}

/* ── Story scenes (client side) ──────────────────────────────────────────
 * IMPORTANT: these are full environmental STORY SCENES for Screens 3-5,
 * distinct from the small interest icons used on Parent Setup
 * (public/images/setup/interest-*.png). Never use a setup icon as a
 * full-screen background — it reads as a stretched app icon, not a scene.
 *
 * Fallback hierarchy actually in effect right now:
 *  1) lib/chapter-scenes.ts's durable generated scene package.
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
  blueprint?: StoryBlueprint,
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
  const chapter: Chapter = {
    ...base,
    pages: draft.sentences.map((text, index) => {
      const beats = blueprint?.beats.filter((beat) => beat.role !== 'branch-consequence') ?? [];
      const beatIndex = beats.length <= 1 || draft.sentences.length <= 1 ? 0 : Math.round(index * (beats.length - 1) / (draft.sentences.length - 1));
      return { text, focusWords: focusFor(text), semanticBeatId: beats[beatIndex]?.beatId };
    }),
    cliffhanger: [draft.sentences.at(-1) ?? skeleton.cliffhangerNote, 'To be continued tomorrow...'],
    teaser: draft.summaryLine || `${profile.childName} has more to discover tomorrow...`,
    phonics: [{ hint: `Stage ${stage} practice`, words: practiceWords }],
    storyBlueprint: blueprint,
    provenance: { source: 'generated', generatedAt: new Date().toISOString() },
  };
  rememberStorySignature(profile, chapter);
  return chapter;
}

const TUTOR_CACHE_PREFIX = 'little-chapters-tutor-chapter:';
const STORY_SIGNATURE_PREFIX = 'little-chapters-story-signatures:';

function storySignatureKey(profile: ChildProfile): string { return `${STORY_SIGNATURE_PREFIX}${profile.childId}`; }
export function recentStorySignatures(profile: ChildProfile): string[] {
  try { return (JSON.parse(localStorage.getItem(storySignatureKey(profile)) ?? '[]') as unknown[]).filter((row): row is string => typeof row === 'string').slice(0, 5); }
  catch { return []; }
}
function rememberStorySignature(profile: ChildProfile, chapter: Chapter): void {
  const blueprint = chapter.storyBlueprint;
  if (!blueprint) return;
  const majorObject = blueprint.entityContinuity[0] ?? 'none';
  const signature = `setting=${blueprint.setting}; goal=${blueprint.characterGoal}; problem=${blueprint.problem}; object=${majorObject}; prediction=${blueprint.prediction.optionA.caption} / ${blueprint.prediction.optionB.caption}; climax=${blueprint.climax}; resolution=${blueprint.resolutionType ?? 'unspecified'}`.slice(0, 700);
  try { localStorage.setItem(storySignatureKey(profile), JSON.stringify([signature, ...recentStorySignatures(profile).filter((row) => row !== signature)].slice(0, 5))); }
  catch { /* novelty memory is best effort */ }
}

function loadCachedTutorChapter(id: string): Chapter | null {
  try {
    const raw = JSON.parse(localStorage.getItem(TUTOR_CACHE_PREFIX + id) ?? 'null') as Chapter | null;
    return raw && raw.provenance?.source !== 'fallback' && raw.provenance?.source !== 'demo/static' && Array.isArray(raw.pages) && raw.pages.length > 0
      ? { ...raw, provenance: { ...raw.provenance, source: 'cached-generated' } }
      : null;
  } catch {
    return null;
  }
}

/* In-flight generations, keyed by chapter id. Every generation is a paid
 * model call, and React StrictMode fires the mount effect twice in dev — so
 * without this, the first load of a day buys the same story twice. */
const inFlight = new Map<string, Promise<Chapter | null>>();
const generationFailures = new Map<string, string>();
let latestGenerationFailure: string | undefined;

export function chapterGenerationFailure(chapterId: string): string | undefined {
  return generationFailures.get(chapterId);
}
export function latestChapterGenerationFailure(): string | undefined { return latestGenerationFailure; }

/* ── Chapter-source observability ─────────────────────────────────────────
 * Module-level (not React state) diagnostics — mirrors AuthProvider's
 * _authDiag/window.__authDebug and lib/audio.ts's _voiceHistory/
 * window.__voiceDebug patterns. Answers, for the CURRENT chapter: did this
 * actually come from OpenAI ('generated') or is the built-in deterministic
 * skeleton pool standing in ('fallback')? Was it freshly generated this
 * call, or served from the persisted today-cache (server, for a signed-in
 * caller) or the local browser cache? Never records prompt text, model
 * output, or any credential — only the id/stage/source/cache facts below. */
export interface ChapterDiag {
  chapterId: string;
  stage: number;
  source: 'generated' | 'fallback';
  /** 'server' = persisted uid+childId+day record (already existed before
   *  this call); 'local' = this browser's TUTOR_CACHE_PREFIX cache;
   *  'fresh' = neither — generation (or its failure) just happened. */
  cacheHit: 'server' | 'local' | 'fresh';
  /** Whether this request went through the persisted /api/chapters/today
   *  path at all (true for any signed-in caller with an ID token) or the
   *  older direct /api/chapters/story call (anonymous/dev/no token —
   *  never persisted server-side, so two devices could still diverge). */
  persisted: boolean;
  sessionDay?: string;
  qaDayRequested?: string | null;
  qaDayAuthorized?: string | null;
  at: number;
}

let _lastChapterDiag: ChapterDiag | null = null;

function recordChapterDiag(diag: Omit<ChapterDiag, 'at'>): void {
  _lastChapterDiag = { ...diag, at: Date.now() };
}

/** Read by window.__chapterDebug() (wired in app/home/page.tsx, the screen
 *  that actually renders "today's chapter") — deliberately NOT gated on
 *  NODE_ENV, same rationale as __authDebug/__voiceDebug: `next build`
 *  always sets NODE_ENV=production, and this exists specifically to answer
 *  "is the live deployed app actually generating chapters, or silently
 *  falling back?" from DevTools on the real app. */
export function chapterDebugInfo(): ChapterDiag | null {
  return _lastChapterDiag;
}

/** The two existing, already-supported GenerateRequest personalization
 *  inputs this task wires up (see docs/ADAPTIVE_LOOP.md, Phase 2) —
 *  factored out from generateTutorChapter() purely so stage resolution and
 *  context-gathering are independently testable without a network call. */
export function resolveGenerationContext(
  profile: ChildProfile,
  uid: string | null,
): { stage: number; skeleton: Skeleton; recentlyMissedWords: string[]; storySoFar: string; recentStorySignatures: string[] } {
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
  return { ...context, recentlyMissedWords, storySoFar, recentStorySignatures: recentStorySignatures(profile) };
}

/** One generation per child per day: the tutor chapter is cached under the
 *  same stable per-day id the demo chapter uses, so a mid-day reload reads
 *  the SAME story instead of paying for (and waiting on) a new one.
 *
 *  For any signed-in caller with an ID token, this now goes through
 *  /api/chapters/today — a persisted, uid+childId+day get-or-create record
 *  (see lib/chapter-store-admin.ts) — instead of the older direct
 *  /api/chapters/story call. That old path is a per-BROWSER localStorage
 *  cache only: two devices (or a cleared browser) signed into the same
 *  account could each independently call OpenAI and cache a DIFFERENT
 *  generated chapter for the same child on the same day. It remains the
 *  fallback for callers with no uid/token (local dev, or a request that
 *  fires before auth has settled), where there is nothing to persist
 *  under anyway. */
export async function requestTutorChapter(profile: ChildProfile, uid: string | null, authToken?: string | null): Promise<Chapter | null> {
  // Stage is part of the cache key: a child whose progress has moved since
  // yesterday must not be served yesterday's-stage story for the rest of
  // the day (same reasoning as the original age-keyed comment here — the
  // source of the stage changed, not the need to key on it).
  const stage = resolveGenerationStage(profile, uid);
  const query = typeof window === 'undefined' || !window.location ? null : new URLSearchParams(window.location.search);
  const qaDay = query?.get('debug') === '1' && isValidDay(query.get('qaDay')) ? query!.get('qaDay')! : null;
  const effectiveDay = qaDay ?? todayLocal();
  const id = `${chapterIdForDay(profile.interests[0], profile.childName, effectiveDay)}:s${stage}`;
  // Signed-in Read sessions resolve through the persisted server authority.
  // A browser cache cannot authorize a preview QA day or prove ownership.
  const persistedRequest = Boolean(uid && authToken);
  const cached = persistedRequest ? null : loadCachedTutorChapter(id);
  if (cached) {
    recordChapterDiag({ chapterId: cached.id, stage, source: 'generated', cacheHit: 'local', persisted: false,
      sessionDay: effectiveDay, qaDayRequested: qaDay, qaDayAuthorized: qaDay });
    return cached;
  }
  const pending = inFlight.get(id);
  if (pending) return pending;
  const run = (async () => {
    let chapter =
      uid && authToken
        ? await generateTutorChapterPersisted(profile, uid, stage, id, authToken, qaDay)
        : await generateTutorChapter(profile, uid, id, authToken);
    // Anonymous/local sessions have no persisted ownership authority. Resolve
    // their deterministic fallback only after the generation request settles,
    // so Read still mounts exactly one canonical chapter rather than a demo
    // placeholder that may later be swapped.
    if (!persistedRequest && !chapter) {
      const fallback = chapterForDay(profile.interests[0], profile.childName, effectiveDay);
      chapter = { ...fallback, provenance: { source: 'fallback', failureReason: generationFailures.get(id) ?? latestGenerationFailure ?? 'story-generation-unavailable',
        sessionDay: effectiveDay, qaDayRequested: qaDay, qaDayAuthorized: qaDay } };
    }
    if (chapter) chapter = { ...chapter, provenance: { ...chapter.provenance!, sessionDay: chapter.provenance?.sessionDay ?? effectiveDay,
      qaDayRequested: qaDay, qaDayAuthorized: chapter.provenance?.qaDayAuthorized ?? (!persistedRequest ? qaDay : null) } };
    recordChapterDiag({
      chapterId: chapter?.id ?? id,
      stage,
      source: chapter && chapter.provenance?.source !== 'fallback' && chapter.provenance?.source !== 'demo/static' ? 'generated' : 'fallback',
      cacheHit: 'fresh',
      persisted: persistedRequest,
      sessionDay: chapter?.provenance?.sessionDay ?? effectiveDay,
      qaDayRequested: qaDay,
      qaDayAuthorized: chapter?.provenance?.qaDayAuthorized ?? null,
    });
    return chapter;
  })();
  inFlight.set(id, run);
  try {
    return await run;
  } finally {
    inFlight.delete(id);
  }
}

/** Persisted path: get-or-create against /api/chapters/today. Server-
 *  authoritative on stage (re-resolved there from the persisted
 *  ChildProgress record, not trusted from this call's `stage` — that's
 *  only used for this function's own local cache key), so a stale client
 *  copy can never fork the persisted record's stage from what the server
 *  considers current. */
async function generateTutorChapterPersisted(
  profile: ChildProfile,
  uid: string,
  stage: number,
  id: string,
  authToken: string,
  qaDay: string | null,
): Promise<Chapter | null> {
  const requestStarted = Date.now();
  const context = resolveGenerationContext(profile, uid);
  const ordinaryDay = todayLocal();
  const day = qaDay ?? ordinaryDay;
  try {
    const response = await fetch('/api/chapters/today', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        profile,
        day,
        ageDerivedStageEstimate: stageForAge(profile.age),
        skeletonId: context.skeleton.id,
        recentlyMissedWords: context.recentlyMissedWords,
        storySoFar: context.storySoFar,
        recentStorySignatures: context.recentStorySignatures,
        qaMode: Boolean(qaDay),
        qaDay,
      }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { reason?: string; error?: string } | null;
      const reason = error?.reason ?? error?.error ?? `story-today-${response.status}`;
      generationFailures.set(id, reason); latestGenerationFailure = reason;
      return null; // caller stays on the deterministic chapter
    }
    const data = (await response.json()) as {
      chapter?: Chapter | null;
      created?: boolean;
      record?: { day: string; source: 'generated' | 'fallback'; stage: number; failureReason?: string; generationDiagnostic?: unknown; draft?: StoryDraft; blueprint?: StoryBlueprint; skeletonId?: string; slots?: Record<string, string> };
    };
    if (data.chapter?.pages?.length) {
      if (data.chapter.provenance?.source === 'fallback') {
        const reason = data.chapter.provenance.failureReason ?? data.record?.failureReason ?? 'unknown';
        generationFailures.set(id, reason); latestGenerationFailure = reason;
      } else {
        generationFailures.delete(id); latestGenerationFailure = undefined;
      }
      if (data.chapter.provenance?.source !== 'fallback') {
        try { localStorage.setItem(TUTOR_CACHE_PREFIX + `${data.chapter.id}:s${stage}`, JSON.stringify(data.chapter)); } catch { /* accelerator only */ }
      }
      const sessionDay = data.record?.day ?? day;
      return { ...data.chapter, provenance: { ...data.chapter.provenance!, sessionDay,
        qaDayRequested: qaDay, qaDayAuthorized: qaDay && sessionDay === qaDay ? qaDay : null,
        storyReadyTiming: { ...data.chapter.provenance?.storyReadyTiming, canonicalRequestMs: Date.now() - requestStarted } } };
    }
    const rec = data.record;
    if (!rec || rec.source !== 'generated' || !rec.draft) {
      const reason = rec?.failureReason ?? 'unknown'; generationFailures.set(id, reason); latestGenerationFailure = reason; return null;
    }
    const skeleton = SKELETONS.find((s) => s.id === rec.skeletonId) ?? context.skeleton;
    const adapted = adaptTutorDraft(profile, rec.draft, skeleton, rec.slots, rec.stage, rec.blueprint);
    const chapter = adapted ? { ...adapted, provenance: { ...adapted.provenance, source: data.created === false ? 'cached-generated' as const : 'generated' as const,
      sessionDay: rec.day ?? day, qaDayRequested: qaDay, qaDayAuthorized: qaDay && (rec.day ?? day) === qaDay ? qaDay : null } } : null;
    if (!chapter) return null;
    try {
      localStorage.setItem(TUTOR_CACHE_PREFIX + `${chapter.id}:s${stage}`, JSON.stringify(chapter));
    } catch {
      /* best-effort cache */
    }
    return chapter;
  } catch {
    return null;
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
    const headers = { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) };
    const lookup = await fetch(`/api/chapters/story?chapterId=${encodeURIComponent(id)}`, { method: 'GET', headers });
    if (lookup.ok) {
      const stored = await lookup.json() as { chapter?: Chapter };
      if (stored.chapter?.pages?.length) {
        const chapter = { ...stored.chapter, provenance: { ...stored.chapter.provenance, source: 'cached-generated' as const } };
        try { localStorage.setItem(TUTOR_CACHE_PREFIX + id, JSON.stringify(chapter)); } catch { /* accelerator only */ }
        generationFailures.delete(id);
        latestGenerationFailure = undefined;
        return chapter;
      }
    } else if (lookup.status !== 404) {
      generationFailures.set(id, `story-lookup-${lookup.status}`);
      latestGenerationFailure = `story-lookup-${lookup.status}`;
      return null;
    }
    const response = await fetch('/api/chapters/story', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        chapterId: id,
        profile,
        stage: context.stage,
        skeletonId: context.skeleton.id,
        recentlyMissedWords: context.recentlyMissedWords,
        storySoFar: context.storySoFar,
        recentStorySignatures: context.recentStorySignatures,
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { reason?: string } | null;
      const reason = body?.reason ?? `story-generation-${response.status}`;
      generationFailures.set(id, reason); latestGenerationFailure = reason; return null;
    }
    const data = await response.json() as { chapter?: Chapter; draft?: StoryDraft; skeleton?: Skeleton; slots?: Record<string, string>; blueprint?: StoryBlueprint };
    if (data.chapter?.pages?.length) {
      generationFailures.delete(id);
      latestGenerationFailure = undefined;
      try { localStorage.setItem(TUTOR_CACHE_PREFIX + id, JSON.stringify(data.chapter)); } catch { /* accelerator only */ }
      return data.chapter;
    }
    if (!data.draft || !data.skeleton) { generationFailures.set(id, 'story-generation-invalid-response'); return null; }
    const chapter = adaptTutorDraft(profile, data.draft, data.skeleton, data.slots, context.stage, data.blueprint);
    if (!chapter) { generationFailures.set(id, 'story-generation-invalid-draft'); return null; }
    generationFailures.delete(id);
    latestGenerationFailure = undefined;
    try {
      localStorage.setItem(TUTOR_CACHE_PREFIX + id, JSON.stringify(chapter));
    } catch {
      /* best-effort cache */
    }
    return chapter;
  } catch (error) {
    generationFailures.set(id, error instanceof Error ? error.message : 'story-generation-network');
    latestGenerationFailure = error instanceof Error ? error.message : 'story-generation-network';
    return null;
  }
}

/** Parent Setup ICON only (small illustration) — never use as a Screen 3-5
 *  full-screen story-scene background. */
export function interestFallbackImage(interest: InterestId | undefined): string {
  return `/images/setup/interest-${interest ?? 'dogs'}.png`;
}
