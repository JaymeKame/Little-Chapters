import type { Chapter } from './chapters';
import { latestChapterGenerationFailure } from './chapters';
import type { ChapterScenePackage } from './chapter-scenes';
import { visualProvenance, sceneUrl } from './chapter-scenes';
import { audioSession } from './audio-session';
import { buildStoryInteractionManifest } from './story-interactions';

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
      assetUrl: scene ? sceneUrl(scenePackage, scene.sceneId) : null,
    };
  });
  const beats = manifest.beats.map((beat) => ({
    beatId: beat.beatId,
    mechanicType: beat.mechanicType,
    sceneId: beat.visualSceneId,
    assetUrl: sceneUrl(scenePackage, beat.visualSceneId),
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

export function chapterDebugSnapshot(chapter: Chapter | null, scenePackage: ChapterScenePackage | null, session?: AdventureTelemetry, context?: { entitlementSource?: 'free' | 'subscription'; scene?: ChapterSceneDebugContext }) {
  const visual = visualProvenance(); const provider = audioSession.providerSnapshot();
  const sceneUrls = context?.scene?.sceneAssetUrls ?? Object.fromEntries(scenePackage?.scenes.map(({ sceneId, assetUrl }) => [sceneId, assetUrl]) ?? []);
  const sceneIdsByUrl = new Map<string, string[]>();
  for (const [sceneId, url] of Object.entries(sceneUrls)) sceneIdsByUrl.set(url, [...(sceneIdsByUrl.get(url) ?? []), sceneId]);
  const duplicateSceneUrls = [...sceneIdsByUrl].filter(([, sceneIds]) => sceneIds.length > 1).map(([url, sceneIds]) => ({ url, sceneIds }));
  const renderedImage = typeof document === 'undefined' ? null : document.querySelector<HTMLImageElement>('.lc-scene-bg img');
  return {
    chapterId: chapter?.id ?? null,
    entitlementSource: chapter?.provenance?.entitlementSource ?? context?.entitlementSource ?? null,
    storySource: chapter?.provenance?.source ?? 'fallback', chapterSource: chapter?.provenance?.source ?? 'fallback', generatedAt: chapter?.provenance?.generatedAt ?? null,
    visualPackageId: scenePackage ? `${scenePackage.chapterId}:v${scenePackage.visualBibleVersion}` : null,
    visualBibleVersion: scenePackage?.visualBibleVersion ?? null,
    visualSource: visual.source, scenes: scenePackage?.scenes.map(({ sceneId, assetUrl }) => ({ sceneId, assetUrl })) ?? [],
    scene: context?.scene ? {
      ...context.scene,
      sceneAssetUrls: sceneUrls,
      sceneSources: context.scene.sceneAssetSources,
      duplicateSceneUrls,
      singleVisualFallback: Object.values(context.scene.sceneAssetSources).length > 0
        && Object.values(context.scene.sceneAssetSources).every((source) => source === 'approved-static-fallback')
        && new Set(Object.values(sceneUrls)).size <= 1,
      renderedImgSrc: renderedImage?.getAttribute('src') ?? null,
      renderedImgCurrentSrc: renderedImage?.currentSrc || null,
      packageProvenance: visual.packageProvenance,
    } : null,
    staticFallbackUsed: visual.source === 'approved-static-fallback', storyGenerationFailureReason: chapter?.provenance?.failureReason ?? latestChapterGenerationFailure() ?? null,
    visualGenerationFailureReason: visual.failureReason ?? null, tutorProviderActuallyPlayed: provider?.provider ?? null,
    voiceFallbackReason: provider?.reason ?? null, session: session?.snapshot() ?? null,
    sceneProgression: sceneProgressionSnapshot(chapter, scenePackage),
  };
}

export function installChapterDebug(getSnapshot: () => ReturnType<typeof chapterDebugSnapshot>): () => void {
  if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') return () => {};
  const target = window as typeof window & { __chapterDebug?: typeof getSnapshot; __sessionDebug?: () => SessionTimingSnapshot | null };
  target.__chapterDebug = getSnapshot;
  return () => { delete target.__chapterDebug; };
}
