import type { Chapter } from './chapters';
import { chapterDebugInfo } from './chapters';
import type { ChapterScenePackage } from './chapter-scenes';
import { visualProvenance, sceneUrl } from './chapter-scenes';
import { audioSession } from './audio-session';
import { buildStoryInteractionManifest } from './story-interactions';
import { LITTLE_CHAPTERS_BUILD, type LittleChaptersBuild } from './build-info';

interface RuntimeEnvironmentDebug {
  openAIConfigured: boolean | null; imageGenerationConfigured: boolean | null;
  firebaseConfigured: boolean | null; storageConfigured: boolean | null;
}
let runtimeEnvironment: RuntimeEnvironmentDebug = {
  openAIConfigured: null, imageGenerationConfigured: null,
  firebaseConfigured: null, storageConfigured: null,
};

function safeAssetUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('/')) return value.split(/[?#]/)[0];
  try { const url = new URL(value); url.search = ''; url.hash = ''; return url.toString(); }
  catch { return value.split(/[?#]/)[0]; }
}

export interface ChapterSceneDebugContext {
  pageIdx: number;
  phase: string;
  activeInteractionId: string | null;
  activeInteractionKind: string | null;
  activeInteractionVisualSceneId: string | null;
  pageAuthoredSceneId: string | null;
  requestedSceneId: string | null;
  resolvedSceneUrl: string | null;
  sceneAssetUrls: Record<string, string>;
  sceneAssetSources: Record<string, 'generated' | 'approved-static-fallback'>;
  loadedSceneUrl?: string | null;
}

export interface CanonicalSessionDebugContext {
  sessionDay: string | null;
  qaDayRequested: string | null;
  qaDayAuthorized: string | null;
  placeholderChapterId: string | null;
  canonicalChapterId: string | null;
  activeChapterId: string | null;
  storyRequestStatus: 'idle' | 'loading' | 'resolved' | 'failed';
  storyRequestChapterId: string | null;
  visualRequestChapterId: string | null;
  canonicalOwnershipReady: boolean;
  readingStartEnabled: boolean;
}

/** Diagnostic mapping for scene progression (correction pass 2, Section 5).
 *  Confirms that a chapter's visible scene actually changes at the intended
 *  narrative moments — one row per page + one row per interaction beat. */
export function sceneProgressionSnapshot(chapter: Chapter | null, scenePackage: ChapterScenePackage | null) {
  if (!chapter) return { pages: [], beats: [] };
  const manifest = buildStoryInteractionManifest(chapter);
  const pages = chapter.pages.map((_, pageIndex) => {
    const scene = manifest.scenes.find((entry) => entry.pageIndexes.includes(pageIndex));
    return {
      pageIndex,
      sceneId: scene?.sceneId ?? null,
      visualPurpose: scene?.visualPurpose ?? null,
      assetUrl: safeAssetUrl(scene ? sceneUrl(scenePackage, scene.sceneId) : null),
    };
  });
  const beats = manifest.beats.map((beat) => ({
    beatId: beat.beatId,
    mechanicType: beat.mechanicType,
    sceneId: beat.visualSceneId,
    assetUrl: safeAssetUrl(sceneUrl(scenePackage, beat.visualSceneId)),
  }));
  return { pages, beats };
}

export interface SessionTimingSnapshot {
  totalDurationMs: number; readingDurationMs: number; listeningDurationMs: number;
  correctionDurationMs: number; interactionDurationMs: number; generationWaitDurationMs: number;
  readingBeats: number; gameBeats: number; corrections: number; tutorUtterances: number;
}

export class AdventureTelemetry {
  private started = Date.now(); private phaseStarted = this.started;
  private phase: 'reading' | 'listening' | 'correction' | 'interaction' | 'generation-wait' = 'generation-wait';
  private durations = { reading: 0, listening: 0, correction: 0, interaction: 0, 'generation-wait': 0 };
  readingBeats = 0; gameBeats = 0; corrections = 0; tutorUtterances = 0;
  enter(phase: AdventureTelemetry['phase']): void { const now = Date.now(); this.durations[this.phase] += now - this.phaseStarted; this.phase = phase; this.phaseStarted = now; }
  count(kind: 'reading' | 'game' | 'correction' | 'utterance'): void {
    if (kind === 'reading') this.readingBeats += 1; else if (kind === 'game') this.gameBeats += 1;
    else if (kind === 'correction') this.corrections += 1; else this.tutorUtterances += 1;
  }
  snapshot(now = Date.now()): SessionTimingSnapshot {
    const current = { ...this.durations }; current[this.phase] += now - this.phaseStarted;
    return { totalDurationMs: now - this.started, readingDurationMs: current.reading, listeningDurationMs: current.listening,
      correctionDurationMs: current.correction, interactionDurationMs: current.interaction, generationWaitDurationMs: current['generation-wait'],
      readingBeats: this.readingBeats, gameBeats: this.gameBeats, corrections: this.corrections, tutorUtterances: this.tutorUtterances };
  }
}

export function chapterDebugSnapshot(chapter: Chapter | null, scenePackage: ChapterScenePackage | null, session?: AdventureTelemetry, context?: { entitlementSource?: 'free' | 'subscription'; recentStorySignatureCount?: number; scene?: ChapterSceneDebugContext; canonicalSession?: CanonicalSessionDebugContext }) {
  const visual = visualProvenance(); const provider = audioSession.providerSnapshot();
  const rawSceneUrls = context?.scene?.sceneAssetUrls ?? Object.fromEntries(scenePackage?.scenes.map(({ sceneId, assetUrl }) => [sceneId, assetUrl]) ?? []);
  const sceneUrls = Object.fromEntries(Object.entries(rawSceneUrls).map(([sceneId, url]) => [sceneId, safeAssetUrl(url) ?? '']));
  const sceneIdsByUrl = new Map<string, string[]>();
  for (const [sceneId, url] of Object.entries(sceneUrls)) sceneIdsByUrl.set(url, [...(sceneIdsByUrl.get(url) ?? []), sceneId]);
  const duplicateSceneUrls = [...sceneIdsByUrl].filter(([, sceneIds]) => sceneIds.length > 1).map(([url, sceneIds]) => ({ url, sceneIds }));
  const renderedImages = typeof document === 'undefined' ? [] : [...document.querySelectorAll<HTMLImageElement>('.lc-scene-bg img')];
  const renderedImage = renderedImages.at(-1) ?? null;
  const lastStoryRequestDiagnostic = chapterDebugInfo();
  const failureReason = chapter?.provenance?.failureReason ?? null;
  const rawStorySource = chapter?.provenance?.source;
  const storySource = rawStorySource === 'generated' ? 'generated'
    : rawStorySource === 'cached-generated' ? 'stored-generated' : 'fallback';
  const packageSource = scenePackage ? visual.source : visual.source === 'approved-static-fallback' ? 'fallback' : 'absent';
  const requestedSceneId = context?.scene?.requestedSceneId ?? null;
  return {
    build: LITTLE_CHAPTERS_BUILD,
    chapter: {
      chapterId: chapter?.id ?? null, storySource,
      generationStatus: !chapter ? 'loading' : storySource === 'fallback' ? 'fallback' : 'ready',
      generationFailureReason: failureReason,
      generationDiagnostic: chapter?.provenance?.generationDiagnostic ?? null,
    },
    story: {
      title: chapter?.title ?? null,
      blueprintId: chapter?.storyBlueprint ? `${chapter.id}:blueprint:v${chapter.storyBlueprint.version}` : null,
      resolutionFunction: chapter?.storyBlueprint?.resolutionType ?? null,
      recentStorySignatureCount: context?.recentStorySignatureCount ?? null,
    },
    visuals: {
      scenePackageStatus: scenePackage ? 'available' : visual.source === 'approved-static-fallback' ? 'fallback' : 'absent',
      packageId: scenePackage ? `${scenePackage.chapterId}:v${scenePackage.visualBibleVersion}` : null,
      packageChapterId: scenePackage?.chapterId ?? null,
      packageVersion: scenePackage?.visualBibleVersion ?? null,
      packageSource, sceneCount: scenePackage?.scenes.length ?? 0, requestedSceneId,
      generationDiagnostic: scenePackage?.imageGenerationDiagnostic ?? visual.diagnostic ?? null,
      resolvedSceneUrl: safeAssetUrl(context?.scene?.resolvedSceneUrl),
      domCurrentSrc: safeAssetUrl(renderedImage?.currentSrc),
      sceneProvenance: requestedSceneId ? context?.scene?.sceneAssetSources[requestedSceneId] ?? null : null,
    },
    environment: runtimeEnvironment,
    canonicalSession: context?.canonicalSession ?? null,
    lastStoryRequestDiagnostic,
    chapterId: chapter?.id ?? null,
    entitlementSource: chapter?.provenance?.entitlementSource ?? context?.entitlementSource ?? null,
    storySource: chapter?.provenance?.source ?? 'fallback', chapterSource: chapter?.provenance?.source ?? 'fallback', generatedAt: chapter?.provenance?.generatedAt ?? null,
    visualPackageId: scenePackage ? `${scenePackage.chapterId}:v${scenePackage.visualBibleVersion}` : null,
    generatedPackageAvailable: Boolean(scenePackage),
    visualBibleVersion: scenePackage?.visualBibleVersion ?? null,
    visualSource: visual.source, scenes: scenePackage?.scenes.map(({ sceneId, assetUrl }) => ({ sceneId, assetUrl: safeAssetUrl(assetUrl) })) ?? [],
    scene: context?.scene ? {
      ...context.scene,
      loadedSceneUrl: safeAssetUrl(context.scene.loadedSceneUrl),
      sceneAssetUrls: sceneUrls,
      sceneSources: context.scene.sceneAssetSources,
      duplicateSceneUrls,
      singleVisualFallback: Object.values(context.scene.sceneAssetSources).length > 0
        && Object.values(context.scene.sceneAssetSources).every((source) => source === 'approved-static-fallback')
        && new Set(Object.values(sceneUrls)).size <= 1,
      renderedImgSrc: safeAssetUrl(renderedImage?.getAttribute('src')),
      renderedImgCurrentSrc: safeAssetUrl(renderedImage?.currentSrc),
      effectiveUrl: safeAssetUrl(context.scene.resolvedSceneUrl),
      packageProvenance: visual.packageProvenance,
    } : null,
    staticFallbackUsed: visual.source === 'approved-static-fallback', storyGenerationFailureReason: chapter?.provenance?.failureReason ?? null,
    visualGenerationFailureReason: visual.failureReason ?? null, tutorProviderActuallyPlayed: provider?.provider ?? null,
    voiceFallbackReason: provider?.reason ?? null, session: session?.snapshot() ?? null,
    sceneProgression: sceneProgressionSnapshot(chapter, scenePackage),
  };
}

export function installChapterDebug(getSnapshot: () => ReturnType<typeof chapterDebugSnapshot>): () => void {
  if (typeof window === 'undefined') return () => {};
  const enabled = process.env.NODE_ENV === 'development' || new URLSearchParams(window.location.search).get('debug') === '1';
  if (!enabled) return () => {};
  const target = window as typeof window & { __chapterDebug?: typeof getSnapshot; __littleChaptersBuild?: LittleChaptersBuild; __sessionDebug?: () => SessionTimingSnapshot | null };
  target.__chapterDebug = getSnapshot;
  target.__littleChaptersBuild = LITTLE_CHAPTERS_BUILD;
  void fetch('/api/health', { cache: 'no-store' }).then((response) => response.ok ? response.json() : null).then((body: { capabilities?: Record<string, { configured?: boolean }> } | null) => {
    const capabilities = body?.capabilities; if (!capabilities) return;
    runtimeEnvironment = {
      openAIConfigured: capabilities.openai?.configured ?? null,
      imageGenerationConfigured: capabilities.openai_images?.configured ?? null,
      firebaseConfigured: capabilities.firebase_admin?.configured ?? null,
      storageConfigured: capabilities.firebase_storage?.configured ?? null,
    };
  }).catch(() => { /* explicit unknowns remain */ });
  return () => { delete target.__chapterDebug; delete target.__littleChaptersBuild; };
}
