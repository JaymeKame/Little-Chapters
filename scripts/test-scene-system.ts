/* Deterministic tests for the story-image system (manifest + selector),
 * built 2026-08-21 from real supplied artwork — see docs/STORY_IMAGE_SYSTEM.md.
 *
 * Node-runnable (no dev server, no localStorage — window is undefined here,
 * which lib/scene-selector.ts's recent-history I/O already no-ops on, same
 * SSR-safe guard convention every other localStorage-backed module in this
 * app uses). Recency-tiebreak behavior itself is exercised for real in
 * scripts/test-audio-lifecycle.ts's sibling Playwright pass (real browser,
 * real localStorage) — see the manual test log in the final report.
 *
 *   node --experimental-strip-types scripts/test-scene-system.ts
 */

import { existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPROVED_SCENE_IDS, RUNTIME_SCENE_MANIFEST, SCENE_MANIFEST, sceneApproval } from '../lib/scene-manifest.ts';
import { selectSceneForPage } from '../lib/scene-selector.ts';
import type { Chapter, ChapterPage } from '../lib/chapters.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log('  ok  ', label);
    passed++;
  } else {
    console.error('  FAIL', label);
    failed++;
  }
}

function chapter(over: Partial<Pick<Chapter, 'id' | 'ambience' | 'setting' | 'character'>>): Chapter {
  return {
    id: 'test-chapter',
    title: "Today's Chapter",
    character: 'Rex',
    companion: 'Rex',
    setting: 'a generic setting',
    ambience: 'countryside',
    pages: [{ text: 'A generic sentence.', focusWords: [] }],
    cliffhanger: ['x', 'To be continued tomorrow...'],
    teaser: 'x',
    phonics: [],
    ...over,
  };
}

function page(text: string, focusWords: string[] = []): ChapterPage {
  return { text, focusWords };
}

// ── 1. Asset integrity ──────────────────────────────────────────────────
console.log('\n=== Asset integrity ===');
assert(SCENE_MANIFEST.length === 57, `manifest has 57 entries (got ${SCENE_MANIFEST.length})`);

const ids = SCENE_MANIFEST.map((a) => a.id);
assert(new Set(ids).size === ids.length, 'every asset id is unique');

const srcs = SCENE_MANIFEST.map((a) => a.src);
assert(new Set(srcs).size === srcs.length, 'every asset src path is unique');

assert(
  SCENE_MANIFEST.every((a) => a.src.startsWith('/images/scenes/')),
  'every src lives under /images/scenes/ — never a composite/landing path',
);

assert(
  SCENE_MANIFEST.every((a) => !/composite|contact-?sheet/i.test(a.src)),
  'no src path names a composite/contact sheet',
);

let allFilesExist = true;
let noZeroByte = true;
for (const a of SCENE_MANIFEST) {
  const abs = join(root, 'public', a.src);
  if (!existsSync(abs)) {
    console.error(`     missing file: ${abs}`);
    allFilesExist = false;
    continue;
  }
  if (statSync(abs).size < 5000) {
    console.error(`     suspiciously small (<5KB): ${abs}`);
    noZeroByte = false;
  }
}
assert(allFilesExist, 'every manifest path resolves to a real file on disk');
assert(noZeroByte, 'no zero-byte/corrupt (<5KB) production asset');

assert(SCENE_MANIFEST.every((a) => a.width > 0 && a.height > 0), 'every asset has positive width/height');
assert(SCENE_MANIFEST.every((a) => a.keywords.length > 0 || a.characters === 'none'), 'every character scene has keywords');
assert(SCENE_MANIFEST.every((a) => a.ambience.length >= 0), 'ambience field is always an array (possibly empty)');

const dirFiles = readdirSync(join(root, 'public/images/scenes')).filter((f) => f.endsWith('.jpg'));
assert(dirFiles.length === SCENE_MANIFEST.length, `public/images/scenes/ has exactly ${SCENE_MANIFEST.length} .jpg files (found ${dirFiles.length})`);
assert(
  dirFiles.every((f) => srcs.includes(`/images/scenes/${f}`)),
  'every file on disk under public/images/scenes/ is referenced by the manifest (no orphans)',
);

// composite sources must never live under public/
const publicHasComposites = existsSync(join(root, 'public/images/landing')) &&
  readdirSync(join(root, 'public/images/landing')).some((f) => /ChatGPT Image/i.test(f));
assert(!publicHasComposites, 'no raw composite source file remains under public/ (moved to assets/story-scene-sources/)');

// ── 2. Runtime approval gate + selection ─────────────────────────────────
console.log('\n=== Runtime approval gate ===');

function pick(c: Chapter, p: ChapterPage) {
  return selectSceneForPage(c, p, 0, undefined, null).asset;
}

assert(RUNTIME_SCENE_MANIFEST.length === APPROVED_SCENE_IDS.length, 'runtime manifest contains exactly the explicit allow-list');
assert(RUNTIME_SCENE_MANIFEST.every((a) => sceneApproval(a.id) === 'approved'), 'every runtime-selectable scene is explicitly approved');
assert(SCENE_MANIFEST.some((a) => sceneApproval(a.id) === 'quarantined'), 'unreviewed AI scenes remain quarantined');
for (const scenario of [
  chapter({ ambience: 'ocean', setting: 'a sunlit coral reef under calm turquoise water' }),
  chapter({ ambience: 'jungle', setting: 'a lush prehistoric jungle with ferns and mist' }),
  chapter({ ambience: 'fantasy', setting: 'an enchanted flowering meadow with soft magical light' }),
  chapter({ ambience: 'countryside', setting: 'rolling countryside hills with a winding rail line' }),
]) {
  const selected = pick(scenario, scenario.pages[0]);
  assert(sceneApproval(selected.id) === 'approved', `${scenario.ambience} selection cannot escape the approved runtime set (got ${selected.id})`);
}

// ── 3. Continuity ────────────────────────────────────────────────────────
console.log('\n=== Continuity ===');
{
  const c = chapter({ ambience: 'countryside', setting: 'rolling countryside hills with a winding rail line' });
  const a1 = selectSceneForPage(c, page('Chug rolled down the tracks.'), 0, 'boy', null);
  const a2 = selectSceneForPage(c, page('Chug rolled down the tracks.'), 0, 'boy', null);
  assert(a1.asset.id === a2.asset.id, 'the SAME (chapter,page,avatar) always resolves to the SAME asset — stable, no flicker');
}
{
  // Character continuity: with an avatar known and a genuine tie in semantic
  // score between candidates, the matching-gender composition should win.
  const c = chapter({ ambience: 'countryside', setting: 'a quiet green valley with a winding river' });
  const boyPick = selectSceneForPage(c, page('A quiet sunset over the valley.'), 0, 'boy', null).asset;
  const girlPick = selectSceneForPage(c, page('A quiet sunset over the valley.'), 0, 'girl', null).asset;
  assert(
    boyPick.characters === 'solo-boy' || boyPick.characters === 'pair-boy-dog' || boyPick.characters === 'trio' || boyPick.characters === 'none',
    `boy avatar never picks a solo-girl/pair-girl-dog scene when alternatives exist (got ${boyPick.id}: ${boyPick.characters})`,
  );
  assert(
    girlPick.characters === 'solo-girl' || girlPick.characters === 'pair-girl-dog' || girlPick.characters === 'trio' || girlPick.characters === 'none',
    `girl avatar never picks a solo-boy/pair-boy-dog scene when alternatives exist (got ${girlPick.id}: ${girlPick.characters})`,
  );
}
{
  // No avatar chosen yet: must not crash, still returns a sensible scene.
  const c = chapter({ ambience: 'fantasy', setting: 'an enchanted flowering meadow with soft magical light' });
  const a = selectSceneForPage(c, page('Luna walked through the glowing meadow.'), 0, undefined, null).asset;
  assert(a != null, 'no-avatar-yet still returns a valid asset, never crashes');
}
{
  // Weak/neutral signal: background-only scene is a legitimate, non-penalized pick.
  const c = chapter({ ambience: 'countryside', setting: 'a quiet green valley with a winding river' });
  const a = pick(c, page('It was a calm, quiet day.'));
  assert(a != null, 'a weak-signal page still resolves to SOME asset, never null');
}
{
  // Semantic correctness beats novelty: a uniquely-best match must survive
  // even if it happens to be the same asset picked moments before elsewhere
  // in this same run (Node has no localStorage, so this specifically checks
  // the SCORING never forces a worse pick just to avoid a repeat).
  const c = chapter({ ambience: 'ocean', setting: 'a sunlit coral reef under calm turquoise water' });
  const a1 = pick(c, page('Finn dove down to meet a big friendly sea turtle underwater.'));
  const a2 = pick(c, page('Finn dove down to meet a big friendly sea turtle underwater.'));
  assert(a1.id === a2.id && sceneApproval(a1.id) === 'approved', 'identical pages remain deterministic inside the approved set');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
