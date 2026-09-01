'use client';

/* Page-level story-scene selection — replaces lib/chapters.ts's old
 * selectStoryScene() (removed; see that file's header comment). Chooses a
 * background from SCENE_MANIFEST (lib/scene-manifest.ts, 57 real, individually
 * cropped production scenes — see docs/STORY_IMAGE_SYSTEM.md) for ONE PAGE of
 * a chapter, not the whole chapter, so a multi-page chapter can progress
 * through different (but thematically related) art instead of showing one
 * static image for every page — see this file's selectSceneForPage().
 *
 * Priority order (per the story-image-system task spec), implemented as a
 * weighted score, highest first — never a brittle if/else chain:
 *   1-4. semantic relevance: keyword/theme overlap between the page's own
 *        text/focus words (heaviest weight) AND the chapter's setting/
 *        character (lighter weight, for story-level continuity) against
 *        each asset's keywords/theme — covers subject, setting, nouns, and
 *        activity all at once, since all of those live in one asset's
 *        keyword list.
 *   5.   character continuity: the child's own avatar (boy/girl) against
 *        the asset's character composition, plus a small dog-presence bonus
 *        ONLY when the story's own companion is a dog (ambience === 'farm'
 *        is the one ambience the 'dogs' interest maps to — see
 *        lib/chapters.ts SETTINGS). Gender is a continuity signal, never a
 *        theme filter: an avatar mismatch is a small penalty, not a ban.
 *   6.   ambience match (asset.ambience includes chapter.ambience).
 *   7.   recent-image avoidance — a TIE-BREAKER only, applied among
 *        near-equal scores (see RECENCY_TIEBREAK_BAND), never overriding a
 *        uniquely-best semantic match. "Semantic correctness beats novelty."
 *
 * Every asset in the manifest gets scored, so this never returns null —
 * uncertainty degrades to the closest semantically compatible scene (often
 * a background-only asset, which always scores at least the ambience/
 * environment match), never to a wrong character/setting and never to a
 * forced pick that ignores relevance. The .lc-scenic/.lc-cliff CSS gradient
 * remains the final fallback ONLY if a chosen asset's <img> 404s at runtime
 * (SceneBackground's onError) — this module always names an asset. */

import type { Chapter, ChapterPage } from './chapters.ts';
import type { AvatarId } from './profile';
import { RUNTIME_SCENE_MANIFEST, type SceneAsset } from './scene-manifest.ts';

export interface SceneSelectionResult {
  asset: SceneAsset;
  score: number;
  /** Human-readable breakdown for tests/debugging — never rendered in the UI. */
  reason: string;
}

export interface AuthoredScenePage {
  sceneId: string;
  page: ChapterPage;
  pageIndex: number;
}

/* ── Recent-image history (per uid, small + bounded) ─────────────────────
 * Same design/localStorage convention as lib/pet.ts and lib/chapter-history.ts
 * (per-uid keys so siblings on one device don't share history). Tracks
 * across BOTH pages within a chapter and chapters across days — a short
 * memory is enough to avoid back-to-back repeats without any "long-term
 * personalization" the task explicitly says not to build. */
const RECENT_HISTORY_KEY_PREFIX = 'little-chapters-recent-scenes:';
const RECENT_HISTORY_MAX = 4;

function historyKey(uid: string | null): string {
  return `${RECENT_HISTORY_KEY_PREFIX}${uid ?? 'anon'}`;
}

function loadRecentHistory(uid: string | null): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem(historyKey(uid)) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function recordRecentHistory(uid: string | null, assetId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const recent = [assetId, ...loadRecentHistory(uid).filter((id) => id !== assetId)].slice(0, RECENT_HISTORY_MAX);
    localStorage.setItem(historyKey(uid), JSON.stringify(recent));
  } catch {
    /* best-effort — recency is a nicety, never required for correctness */
  }
}

/* ── Keyword extraction ──────────────────────────────────────────────── */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'was', 'were', 'is', 'are', 'be',
  'been', 'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'it', 'its',
  'this', 'that', 'there', 'who', 'what', 'came', 'kept', 'went', 'said',
  'one', 'out', 'all', 'very', 'then', 'top', 'up', 'down', 'into', 'over',
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Lightweight match, not a real stemmer: exact equality, or one word is a
 *  ≥4-letter prefix of the other. Catches the common inflections that show
 *  up across free-text page sentences vs. the manifest's base-form keywords
 *  ("snowy"~"snow", "sledding"~"sled", "trains"~"train") without a real NLP
 *  dependency. The length-4 floor keeps short unrelated words (e.g. "sun"
 *  vs "sunk") from false-matching. */
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 4 && longer.startsWith(shorter);
}

function overlapCount(query: string[], candidates: string[]): number {
  let n = 0;
  for (const q of query) if (candidates.some((c) => wordsMatch(q, c))) n += 1;
  return n;
}

/** Manifest keywords/theme entries are sometimes multi-word phrases
 *  ("floating castle", "hot air balloon") for human readability — expand
 *  each into its individual word tokens too (keeping the original phrase
 *  as well) so a single-word page/chapter query token ("castle", "balloon")
 *  can still match a candidate whose only mention of it is inside a phrase. */
function expandCandidateWords(asset: SceneAsset): string[] {
  const raw = [...asset.keywords, ...asset.theme, asset.environment];
  const expanded = new Set<string>();
  for (const phrase of raw) {
    expanded.add(phrase.toLowerCase());
    for (const word of tokenize(phrase)) expanded.add(word);
  }
  return [...expanded];
}

/* ── Character continuity ─────────────────────────────────────────────── */

/** How well an asset's character composition continues a story the child
 *  (avatar-known) is reading. Mismatches are a mild penalty, never a hard
 *  exclusion — the manifest may simply have no matching-gender asset for an
 *  otherwise perfect semantic match, and a wrong CHARACTER read is worse
 *  than a wrong gender. `none` (background-only) is always neutral-safe. */
function characterContinuityScore(asset: SceneAsset, avatar: AvatarId | undefined, dogBias: boolean): number {
  let score = 0;
  if (avatar === 'boy') {
    if (asset.characters === 'solo-boy' || asset.characters === 'pair-boy-dog') score += 3;
    else if (asset.characters === 'trio') score += 2;
    else if (asset.characters === 'solo-girl' || asset.characters === 'pair-girl-dog') score -= 1;
  } else if (avatar === 'girl') {
    if (asset.characters === 'solo-girl' || asset.characters === 'pair-girl-dog') score += 3;
    else if (asset.characters === 'trio') score += 2;
    else if (asset.characters === 'solo-boy' || asset.characters === 'pair-boy-dog') score -= 1;
  }
  // No avatar chosen yet: no gender signal to apply — every composition is
  // equally valid, per "gender is a continuity signal, not a theme filter."
  if (dogBias && asset.dogPresent) score += 1;
  if (asset.characters === 'none') score += 0.5; // safe neutral fallback
  return score;
}

/* ── Scoring ──────────────────────────────────────────────────────────── */

/** Small deterministic tie-break so equal-scoring candidates don't depend on
 *  manifest array order — stable per chapter+page, not random per render. */
function stableHash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h;
}

/** Scores within this band of the top score are considered "near-equal" —
 *  recency only breaks ties within this band, never overrides a uniquely
 *  best semantic match outside it. */
const RECENCY_TIEBREAK_BAND = 3;

function scoreAsset(
  asset: SceneAsset,
  pageQuery: string[],
  chapterQuery: string[],
  chapter: Chapter,
  avatar: AvatarId | undefined,
  dogBias: boolean,
): number {
  const candidateWords = expandCandidateWords(asset);
  const pageRelevance = overlapCount(pageQuery, candidateWords) * 6;
  const chapterRelevance = overlapCount(chapterQuery, candidateWords) * 2;
  const ambienceMatch = asset.ambience.includes(chapter.ambience) ? 4 : 0;
  const character = characterContinuityScore(asset, avatar, dogBias);
  return pageRelevance + chapterRelevance + ambienceMatch + character;
}

/** Selects the best background for ONE page of a chapter. Deterministic per
 *  (chapter.id, pageIndex, avatar) except for the recency tie-break, which
 *  depends on this uid's actual recent-selection history — call once per
 *  page render (e.g. from a useMemo keyed on [chapter.id, pageIndex,
 *  avatar, uid]), not on every re-render, since it also records history as
 *  a side effect. */
export function selectSceneForPage(
  chapter: Chapter,
  page: ChapterPage,
  pageIndex: number,
  avatar: AvatarId | undefined,
  uid: string | null,
): SceneSelectionResult {
  // PAGE-only signal — deliberately excludes chapter.setting/character so a
  // page's own specific content (this sentence's nouns/activity) is never
  // diluted or drowned out by the story's generic base setting text, which
  // is often broad ("a sunny countryside farm...") and would otherwise
  // out-match a page's one sharp, specific keyword (e.g. "lighthouse") by
  // sheer word count. Story-level continuity is chapterQuery's job, below,
  // at its own deliberately lower weight.
  const pageQuery = [...tokenize(page.text), ...page.focusWords.map((w) => w.toLowerCase())];
  // Chapter-level query (setting + character only, no page text) anchors
  // story-level continuity — every page gets a small bonus for staying
  // broadly on the chapter's own theme, on top of whatever that page's own
  // text additionally suggests.
  const chapterQuery = [...tokenize(chapter.setting), ...tokenize(chapter.character)];
  const dogBias = chapter.ambience === 'farm'; // see SETTINGS in lib/chapters.ts — the only ambience the 'dogs' interest maps to
  const recent = loadRecentHistory(uid);

  const scored = RUNTIME_SCENE_MANIFEST.map((asset) => ({
    asset,
    score: scoreAsset(asset, pageQuery, chapterQuery, chapter, avatar, dogBias),
  })).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Deterministic, not array-order-dependent, tie-break.
    return stableHash(`${chapter.id}:${pageIndex}:${a.asset.id}`) - stableHash(`${chapter.id}:${pageIndex}:${b.asset.id}`);
  });

  const top = scored[0].score;
  const nearTop = scored.filter((s) => top - s.score <= RECENCY_TIEBREAK_BAND);
  const nonRecentNearTop = nearTop.filter((s) => !recent.includes(s.asset.id));
  const winner = nonRecentNearTop[0] ?? scored[0];

  recordRecentHistory(uid, winner.asset.id);

  return {
    asset: winner.asset,
    score: winner.score,
    reason: `page="${page.text.slice(0, 40)}${page.text.length > 40 ? '…' : ''}" ambience=${chapter.ambience} avatar=${avatar ?? 'none'} -> ${winner.asset.id} (score ${winner.score}, top ${top})`,
  };
}

/** Select one approved static asset per AUTHORED scene, preserving semantic
 * ranking while avoiding duplicate wallpaper whenever the approved library
 * has enough assets. Generated packages bypass this map entirely. */
export function selectStaticSceneSequence(
  chapter: Chapter,
  scenes: readonly AuthoredScenePage[],
  avatar: AvatarId | undefined,
  uid: string | null,
): Record<string, SceneSelectionResult> {
  const used = new Set<string>();
  const result: Record<string, SceneSelectionResult> = {};
  const chapterQuery = [...tokenize(chapter.setting), ...tokenize(chapter.character)];
  const dogBias = chapter.ambience === 'farm';

  for (const scene of scenes) {
    const pageQuery = [...tokenize(scene.page.text), ...scene.page.focusWords.map((word) => word.toLowerCase())];
    const ranked = RUNTIME_SCENE_MANIFEST.map((asset) => ({
      asset,
      score: scoreAsset(asset, pageQuery, chapterQuery, chapter, avatar, dogBias),
    })).sort((a, b) => b.score - a.score
      || stableHash(`${chapter.id}:${scene.pageIndex}:${a.asset.id}`) - stableHash(`${chapter.id}:${scene.pageIndex}:${b.asset.id}`));
    // Narrative relevance wins. Avoid repetition only among candidates close
    // enough to the best semantic score; never trade a matching bridge/forest
    // beat for an unrelated landscape merely to make the URL different.
    const topScore = ranked[0].score;
    const winner = ranked.find(({ asset, score }) => topScore - score <= RECENCY_TIEBREAK_BAND && !used.has(asset.id))
      // A truthful but slightly less-specific approved scene is preferable to
      // showing the same wallpaper for most of a fallback chapter. Reuse only
      // after the complete approved pool is exhausted.
      ?? ranked.find(({ asset }) => !used.has(asset.id))
      ?? ranked[0];
    used.add(winner.asset.id);
    recordRecentHistory(uid, winner.asset.id);
    result[scene.sceneId] = {
      asset: winner.asset,
      score: winner.score,
      reason: `authored-scene=${scene.sceneId} page=${scene.pageIndex} -> ${winner.asset.id} (semantic score ${winner.score}; uniqueness only within relevance band)`,
    };
  }
  return result;
}
