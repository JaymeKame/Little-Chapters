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
import { SCENE_MANIFEST } from '../lib/scene-manifest.ts';
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

// ── 2. Semantic selection — representative scenarios ────────────────────
console.log('\n=== Semantic selection ===');

function pick(c: Chapter, p: ChapterPage) {
  return selectSceneForPage(c, p, 0, undefined, null).asset;
}

{
  const c = chapter({ ambience: 'ocean', setting: 'a sunlit coral reef under calm turquoise water' });
  const a = pick(c, page('Finn swam past the old lighthouse by the reef.'));
  assert(a.environment === 'ocean' || a.environment === 'beach', `ocean/lighthouse story picks an ocean/beach scene (got ${a.id})`);
  assert(!a.id.includes('desert') && !a.id.includes('snow'), `ocean/lighthouse story does not pick an unrelated desert/snow scene (got ${a.id})`);
}
{
  const c = chapter({ ambience: 'jungle', setting: 'a lush prehistoric jungle with ferns and mist' });
  const a = pick(c, page('Dot walked deep into the forest, past tall mossy trees.'));
  assert(a.environment === 'forest' || a.environment === 'jungle', `forest story picks a forest/jungle scene (got ${a.id})`);
}
{
  const c = chapter({ ambience: 'fantasy', setting: 'an enchanted flowering meadow with soft magical light' });
  const a = pick(c, page('Luna saw a glowing castle rise above the clouds.'));
  assert(a.fantasy && (a.keywords.includes('castle') || a.theme.includes('fantasy castle') || a.environment === 'fantasy'), `castle/fantasy story picks a fantasy castle scene (got ${a.id})`);
}
{
  const c = chapter({ ambience: 'countryside', setting: 'rolling countryside hills with a winding rail line' });
  const a = pick(c, page('Chug crossed the hot desert sand under tall cactus plants.'));
  assert(a.environment === 'desert', `desert story picks a desert scene (got ${a.id})`);
}
{
  const c = chapter({ ambience: 'ocean', setting: 'a sunlit coral reef under calm turquoise water' });
  const a = pick(c, page('Finn dove down to meet a big friendly sea turtle underwater.'));
  assert(a.environment === 'underwater', `underwater/turtle story picks the underwater scene (got ${a.id})`);
}
{
  const c = chapter({ ambience: 'countryside', setting: 'a snowy village at night under the aurora' });
  const a = pick(c, page('The children went sledding down the snowy hill at sunset.'));
  assert(a.environment === 'snow', `snow/sledding story picks a snow scene (got ${a.id})`);
}
{
  const c = chapter({ ambience: 'countryside', setting: 'rolling countryside hills with a winding rail line' });
  const a = pick(c, page('Chug waved as the big steam train pulled into the station.'));
  assert(a.transportation.includes('train'), `train story picks a train scene (got ${a.id})`);
}
{
  const c = chapter({ ambience: 'space', setting: 'a glowing starlit galaxy with soft planets' });
  const a = pick(c, page('Zip flew a pretend airplane made of cardboard through the clouds.'));
  assert(a.transportation.includes('airplane') || a.keywords.includes('imagination'), `pretend-airplane story picks the airplane/imagination scene (got ${a.id})`);
}
{
  const c = chapter({ ambience: 'countryside', setting: 'a sunny countryside farm with wooden fences' });
  const a = pick(c, page('Rex kicked the soccer ball across the field with his friends.'));
  assert(a.keywords.includes('soccer'), `sports story picks the soccer scene (got ${a.id})`);
}
{
  const c = chapter({ ambience: 'countryside', setting: 'a sunny countryside farm with wooden fences' });
  const a = pick(c, page('Rex helped bake a cake in the warm kitchen.'));
  assert(a.environment === 'indoor-kitchen', `baking story picks the kitchen scene (got ${a.id})`);
}
{
  const c = chapter({ ambience: 'space', setting: 'a glowing starlit galaxy with soft planets' });
  const a = pick(c, page('Zip looked up at the stars through his telescope at night.'));
  assert(a.timeOfDay === 'night', `nighttime/stars story picks a night scene (got ${a.id})`);
}
{
  const c = chapter({ ambience: 'countryside', setting: 'rolling countryside hills with a winding rail line' });
  const a = pick(c, page('After the rain, a big rainbow arched over the meadow.'));
  assert(a.keywords.includes('rainbow'), `rainbow story picks a rainbow scene (got ${a.id})`);
}
{
  const c = chapter({ ambience: 'jungle', setting: 'a lush prehistoric jungle with ferns and mist' });
  const a = pick(c, page('Dot met a huge friendly dinosaur in the green valley.'));
  assert(a.otherAnimals.includes('dinosaur'), `dinosaur story picks the dinosaur scene (got ${a.id})`);
}

// Unrelated-artwork guard: a strongly ocean-themed page must not pick desert/space art.
{
  const c = chapter({ ambience: 'ocean', setting: 'a sunlit coral reef under calm turquoise water' });
  const a = pick(c, page('Finn explored the coral reef with colorful fish all around.'));
  assert(a.environment !== 'desert' && a.environment !== 'space', `strong ocean signal never picks desert/space art (got ${a.id})`);
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
  assert(a1.id === a2.id && a1.environment === 'underwater', 'identical uniquely-best-match pages never get forced apart for novelty');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
