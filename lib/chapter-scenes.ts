
import type { User } from 'firebase/auth';
import type { Chapter } from './chapters';
import type { StoryInteractionManifest } from './story-interactions';
import type { ImageGenerationAttemptDiagnostic } from './image-review-contract';

export const VISUAL_BIBLE_VERSION = 2;
export interface SceneEntityRegion { x: number; y: number; width: number; height: number }

/** Correction sprint Sections 3-5: distinguish a REQUESTED entity (present in
 *  the generation prompt / interaction manifest) from a VERIFIED VISIBLE
 *  entity — one whose presence in the final rendered image has been confirmed
 *  by the image-review pass. Only VERIFIED entities may back a spatial "find
 *  it in the scene" interaction; every other beat must gracefully fall back
 *  to the tactile-card render so a child is never asked to locate an object
 *  that is not actually in the picture. */
export type EntityVerificationSource = 'reviewer' | 'inferred' | 'unverified';
export interface SceneEntityMetadata {
  entityId: string;
  label: string;
  semanticRole: 'character' | 'story-object' | 'clue' | 'setting' | 'literacy-target';
  interactionBeatIds: string[];
  approximateRegion: SceneEntityRegion;
  /** 0..1 — how confident the review stage was that this entity is visible
   *  in the final image. Consumers requiring spatial interaction MUST
   *  refuse below 0.6 and switch to a tactile-card fallback. */
  verificationConfidence: number;
  verificationSource: EntityVerificationSource;
}
export interface GeneratedSceneAsset {
  sceneId: string;
  assetUrl: string;
  visualPurpose: string;
  entities: SceneEntityMetadata[];
}
export interface ChapterScenePackage {
  chapterId: string;
  storyFingerprint?: string;
  visualBibleVersion: number;
  provider: string;
  generatedAt: string;
  generationLatencyMs: number;
  scenes: GeneratedSceneAsset[];
  imageGenerationDiagnostic?: { attempts: ImageGenerationAttemptDiagnostic[] };
}

const CACHE_PREFIX = 'little-chapters-scene-package:';
export type VisualSource = 'generated' | 'cached-generated' | 'approved-static-fallback';
export type ScenePackageProvenance = 'local-storage' | 'server-cache' | 'generated' | 'approved-static-fallback';
let latestVisualState: { source: VisualSource; packageProvenance: ScenePackageProvenance; failureReason?: string; diagnostic?: { attempts: ImageGenerationAttemptDiagnostic[] } } = { source: 'approved-static-fallback', packageProvenance: 'approved-static-fallback' };
export function visualProvenance(): typeof latestVisualState { return { ...latestVisualState }; }
export function scenePackageCacheKey(chapterId: string) { return `${CACHE_PREFIX}${chapterId}:v${VISUAL_BIBLE_VERSION}`; }

export function chapterStoryFingerprint(chapter: Chapter): string {
  const input = JSON.stringify({ id: chapter.id, pages: chapter.pages.map((page) => page.text), setting: chapter.setting });
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) { hash ^= input.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function loadChapterScenePackage(chapterId: string, expectedFingerprint?: string): ChapterScenePackage | null {
  try {
    const value = JSON.parse(localStorage.getItem(scenePackageCacheKey(chapterId)) ?? 'null') as ChapterScenePackage | null;
    if (value?.chapterId === chapterId && (!expectedFingerprint || value.storyFingerprint === expectedFingerprint) && value.visualBibleVersion === VISUAL_BIBLE_VERSION && value.scenes.length >= 3) {
      latestVisualState = { source: 'cached-generated', packageProvenance: 'local-storage', diagnostic: value.imageGenerationDiagnostic }; return value;
    }
    return null;
  } catch { return null; }
}

export function saveChapterScenePackage(value: ChapterScenePackage): ChapterScenePackage {
  try { localStorage.setItem(scenePackageCacheKey(value.chapterId), JSON.stringify(value)); } catch { /* server remains authoritative */ }
  return value;
}

async function authHeaders(user: User | null): Promise<Record<string, string>> {
  const token = user ? await user.getIdToken().catch(() => null) : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Resolve the server-authoritative package without asking the provider to
 * generate anything. A missing package is the only condition that permits
 * requestChapterScenePackage() to proceed to POST.
 */
export async function lookupChapterScenePackage(chapterId: string, user: User | null, storyFingerprint?: string): Promise<ChapterScenePackage | null | undefined> {
  try {
    const response = await fetch(`/api/chapters/visuals?chapterId=${encodeURIComponent(chapterId)}${storyFingerprint ? `&storyFingerprint=${encodeURIComponent(storyFingerprint)}` : ''}`, {
      method: 'GET', headers: await authHeaders(user), cache: 'no-store',
    });
    if (response.status === 404) return undefined;
    if (!response.ok) { latestVisualState = { source: 'approved-static-fallback', packageProvenance: 'approved-static-fallback', failureReason: `visual-lookup-${response.status}` }; return null; }
    const body = await response.json() as { scenePackage?: ChapterScenePackage; cache?: 'hit' | 'miss' };
    if (body.scenePackage) { latestVisualState = { source: 'cached-generated', packageProvenance: 'server-cache', diagnostic: body.scenePackage.imageGenerationDiagnostic }; return saveChapterScenePackage(body.scenePackage); }
    latestVisualState = { source: 'approved-static-fallback', packageProvenance: 'approved-static-fallback', failureReason: 'visual-lookup-invalid-response' }; return null;
  } catch (error) { latestVisualState = { source: 'approved-static-fallback', packageProvenance: 'approved-static-fallback', failureReason: error instanceof Error ? error.message : 'visual-lookup-network' }; return null; }
}

export async function requestChapterScenePackage(chapter: Chapter, manifest: StoryInteractionManifest, user: User | null): Promise<ChapterScenePackage | null> {
  const cached = loadChapterScenePackage(chapter.id, chapterStoryFingerprint(chapter));
  // A local package is an immediate paint accelerator, not the authority.
  // Always hydrate against the server so a newly generated/reviewed package
  // can replace an older browser copy instead of being permanently hidden by
  // the early cache return that physical testing exposed.
  const existing = await lookupChapterScenePackage(chapter.id, user, chapterStoryFingerprint(chapter));
  if (existing !== undefined) return existing ?? cached;
  try {
    const response = await fetch('/api/chapters/visuals', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders(user)) },
      body: JSON.stringify({ chapter, manifest }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { reason?: string; error?: string; diagnostic?: { attempts: ImageGenerationAttemptDiagnostic[] } } | null;
      latestVisualState = { source: 'approved-static-fallback', packageProvenance: 'approved-static-fallback', failureReason: error?.reason ?? error?.error?.toLowerCase().replaceAll('_', '-') ?? `visual-generation-${response.status}`, diagnostic: error?.diagnostic }; return null;
    }
    const body = await response.json() as { scenePackage?: ChapterScenePackage; cache?: 'hit' | 'miss' };
    if (body.scenePackage) { latestVisualState = { source: body.cache === 'hit' ? 'cached-generated' : 'generated', packageProvenance: body.cache === 'hit' ? 'server-cache' : 'generated', diagnostic: body.scenePackage.imageGenerationDiagnostic }; return saveChapterScenePackage(body.scenePackage); }
    latestVisualState = { source: 'approved-static-fallback', packageProvenance: 'approved-static-fallback', failureReason: 'visual-generation-invalid-response' }; return null;
  } catch (error) { latestVisualState = { source: 'approved-static-fallback', packageProvenance: 'approved-static-fallback', failureReason: error instanceof Error ? error.message : 'visual-generation-network' }; return null; }
}

export function sceneUrl(scenePackage: ChapterScenePackage | null, sceneId: string): string | null {
  return scenePackage?.scenes.find((scene) => scene.sceneId === sceneId)?.assetUrl ?? null;
}
