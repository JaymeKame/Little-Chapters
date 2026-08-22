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

/** Selects one stable image from the explicit August 21 allow-list. */
export function selectSceneForPage(
  chapter: Chapter,
  _page: ChapterPage,
  _pageIndex: number,
  _avatar: AvatarId | undefined,
  _uid: string | null,
): SceneSelectionResult {
  const asset = SCENE_MANIFEST[stableHash(chapter.id) % SCENE_MANIFEST.length];
  return {
    asset,
    score: 0,
    reason: `chapter=${chapter.id} -> ${asset.id}`,
  };
}
