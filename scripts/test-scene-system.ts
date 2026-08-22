import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENE_MANIFEST } from '../lib/scene-manifest.ts';
import { selectSceneForPage } from '../lib/scene-selector.ts';
import type { Chapter } from '../lib/chapters.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
  console.log(`ok - ${message}`);
}

function chapter(id: string): Chapter {
  return {
    id,
    title: 'A chapter',
    character: 'Momo',
    companion: 'Momo',
    setting: 'A story setting',
    ambience: 'countryside',
    pages: [{ text: 'A story page.', focusWords: [] }],
    cliffhanger: ['Tomorrow', 'To be continued tomorrow...'],
    teaser: 'Tomorrow',
    phonics: [],
  };
}

assert(SCENE_MANIFEST.length === 6, 'manifest contains the six eligible standalone story backgrounds');
assert(SCENE_MANIFEST.every(({ src }) => !src.startsWith('/images/scenes/')), 'legacy scenes directory is excluded');
assert(SCENE_MANIFEST.every(({ src }) => !/icon|avatar|setup|reward|logo|screenshot/i.test(src)), 'UI and setup assets are excluded');
assert(new Set(SCENE_MANIFEST.map(({ src }) => src)).size === SCENE_MANIFEST.length, 'background paths are unique');

for (const asset of SCENE_MANIFEST) {
  const path = join(root, 'public', asset.src);
  assert(existsSync(path) && statSync(path).size > 100_000, `${asset.id} is a present high-resolution asset`);
}

const first = chapter('persisted-chapter-2026-08-22');
const firstPick = selectSceneForPage(first, first.pages[0], 0, 'boy', 'parent-1').asset.src;
const refreshedPick = selectSceneForPage(first, first.pages[0], 1, 'girl', 'parent-2').asset.src;
assert(firstPick === refreshedPick, 'same chapter ID stays stable across page, avatar, user, and refresh state');

const rotated = new Set(
  Array.from({ length: 60 }, (_, index) => {
    const item = chapter(`persisted-chapter-${index}`);
    return selectSceneForPage(item, item.pages[0], 0, undefined, null).asset.src;
  }),
);
assert(rotated.size === SCENE_MANIFEST.length, 'different chapter IDs rotate across the full eligible pool');

console.log(`\n${SCENE_MANIFEST.length} eligible backgrounds verified.`);
