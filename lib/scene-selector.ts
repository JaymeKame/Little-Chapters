'use client';

import type { Chapter, ChapterPage } from './chapters.ts';
import type { AvatarId } from './profile';
import { SCENE_MANIFEST, type SceneAsset } from './scene-manifest.ts';

export interface SceneSelectionResult {
  asset: SceneAsset;
  score: number;
  reason: string;
}

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Select one stable background for a persisted chapter. Page, avatar, and
 * browser history intentionally do not affect the choice, so reopening the
 * same chapter cannot change its artwork. The explicit manifest is the only
 * selectable pool; legacy assets under `/images/scenes/` are unreachable.
 */
export function selectSceneForPage(
  chapter: Chapter,
  _page: ChapterPage,
  _pageIndex: number,
  _avatar: AvatarId | undefined,
  _uid: string | null,
): SceneSelectionResult {
  const index = stableHash(chapter.id) % SCENE_MANIFEST.length;
  const asset = SCENE_MANIFEST[index];

  return {
    asset,
    score: 0,
    reason: `chapter=${chapter.id} -> ${asset.id}`,
  };
}
