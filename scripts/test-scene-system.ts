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

assert(SCENE_MANIFEST.length === 13, 'manifest contains all 13 August 21 backgrounds');
assert(new Set(SCENE_MANIFEST.map(({ src }) => src)).size === 13, 'all background paths are unique');
assert(
  SCENE_MANIFEST.every(({ src }) => src.startsWith('/images/landing/ChatGPT Image Aug 21, 2026 at ')),
  'only the approved August 21 landing assets are selectable',
);
assert(SCENE_MANIFEST.every(({ src }) => !src.startsWith('/images/scenes/')), 'legacy scene crops are unreachable');
assert(
  SCENE_MANIFEST.every(({ src }) => !/dinosaurs-|ocean-|space-|unicorns-|hero-bear|landing-reading-scene|icon-/i.test(src)),
  'legacy landing art and UI graphics are unreachable',
);

for (const asset of SCENE_MANIFEST) {
  const path = join(root, 'public', asset.src);
  assert(existsSync(path) && statSync(path).size > 2_000_000, `${asset.id} resolves to its high-resolution file`);
}

const persisted = chapter('persisted-chapter-2026-08-22');
const initial = selectSceneForPage(persisted, persisted.pages[0], 0, 'boy', 'parent-1').asset.src;
const refreshed = selectSceneForPage(persisted, persisted.pages[0], 1, 'girl', 'parent-2').asset.src;
assert(initial === refreshed, 'the same persisted chapter ID always selects the same background');

const selected = new Set(
  Array.from({ length: 260 }, (_, index) => {
    const item = chapter(`persisted-chapter-${index}`);
    return selectSceneForPage(item, item.pages[0], 0, undefined, null).asset.src;
  }),
);
assert(selected.size === 13, 'different chapter IDs reach all 13 backgrounds deterministically');

console.log('\n13 presentation backgrounds verified.');
