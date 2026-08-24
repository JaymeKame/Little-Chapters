
import type { User } from 'firebase/auth';
import type { Chapter } from './chapters';
import type { StoryInteractionManifest } from './story-interactions';

export const VISUAL_BIBLE_VERSION = 1;
export interface SceneEntityRegion { x: number; y: number; width: number; height: number }
export interface SceneEntityMetadata {
  entityId: string;
  label: string;
  semanticRole: 'character' | 'story-object' | 'clue' | 'setting' | 'literacy-target';
  interactionBeatIds: string[];
  approximateRegion: SceneEntityRegion;
}
export interface GeneratedSceneAsset {
  sceneId: string;
  assetUrl: string;
  visualPurpose: string;
  entities: SceneEntityMetadata[];
}
export interface ChapterScenePackage {
  chapterId: string;
  visualBibleVersion: number;
  provider: string;
  generatedAt: string;
  generationLatencyMs: number;
  scenes: GeneratedSceneAsset[];
}

const CACHE_PREFIX = 'little-chapters-scene-package:';
export function scenePackageCacheKey(chapterId: string) { return `${CACHE_PREFIX}${chapterId}:v${VISUAL_BIBLE_VERSION}`; }

export function loadChapterScenePackage(chapterId: string): ChapterScenePackage | null {
  try {
    const value = JSON.parse(localStorage.getItem(scenePackageCacheKey(chapterId)) ?? 'null') as ChapterScenePackage | null;
    return value?.chapterId === chapterId && value.visualBibleVersion === VISUAL_BIBLE_VERSION && value.scenes.length >= 3 ? value : null;
  } catch { return null; }
}

export function saveChapterScenePackage(value: ChapterScenePackage): ChapterScenePackage {
  try { localStorage.setItem(scenePackageCacheKey(value.chapterId), JSON.stringify(value)); } catch { /* server remains authoritative */ }
  return value;
}

export async function requestChapterScenePackage(chapter: Chapter, manifest: StoryInteractionManifest, user: User | null): Promise<ChapterScenePackage | null> {
  const cached = loadChapterScenePackage(chapter.id);
  if (cached) return cached;
  try {
    const token = user ? await user.getIdToken().catch(() => null) : null;
    const response = await fetch('/api/chapters/visuals', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ chapter, manifest }),
    });
    if (!response.ok) return null;
    const body = await response.json() as { scenePackage?: ChapterScenePackage };
    return body.scenePackage ? saveChapterScenePackage(body.scenePackage) : null;
  } catch { return null; }
}

export function sceneUrl(scenePackage: ChapterScenePackage | null, sceneId: string): string | null {
  return scenePackage?.scenes.find((scene) => scene.sceneId === sceneId)?.assetUrl ?? null;
}
