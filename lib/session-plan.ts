import type { Chapter } from './chapters';
import { buildStoryInteractionManifest, type StoryInteractionBeat, type StoryInteractionManifest } from './story-interactions.ts';
import { composeSession, type MechanicKind } from './session-composer.ts';

export type SessionBeat =
  | { id: 'welcome'; kind: 'welcome'; spokenLine: string }
  | { id: string; kind: 'reading'; pageIndexes: number[]; finalChallenge: boolean }
  | { id: 'sound-hunt'; kind: 'sound-hunt'; afterPage: number; activity: StoryInteractionBeat }
  | { id: 'find-in-scene'; kind: 'find-in-scene'; afterPage: number; activity: StoryInteractionBeat }
  | { id: 'prediction'; kind: 'prediction'; afterPage: number; activity: StoryInteractionBeat }
  | { id: 'word-builder'; kind: 'word-builder'; afterPage: number; activity: StoryInteractionBeat }
  | { id: 'ending'; kind: 'ending' };

export interface SoundHunt { pattern: string; prompt: string; choices: [string, string, string]; answer: string }

export function buildSoundHunt(chapter: Chapter): SoundHunt {
  const beat = buildStoryInteractionManifest(chapter).beats.find((item) => item.mechanicType === 'find-sound')!;
  return { pattern: beat.literacyTarget!, prompt: beat.spokenInstruction, choices: beat.interactiveObjects.map((item) => item.label) as [string, string, string], answer: beat.correctTarget! };
}

/** Which mechanics the manifest actually supports for this chapter. A
 *  mechanic that has no beat, no target, or an empty choice list must not be
 *  offered — the composer will simply not pick it. */
function mechanicsAvailableIn(manifest: StoryInteractionManifest): Record<MechanicKind, boolean> {
  const findSound = manifest.beats.find((beat) => beat.mechanicType === 'find-sound');
  const findScene = manifest.beats.find((beat) => beat.mechanicType === 'find-it-in-scene');
  const prediction = manifest.beats.find((beat) => beat.mechanicType === 'what-happens-next');
  const builder = manifest.beats.find((beat) => beat.mechanicType === 'word-builder');
  return {
    'sound-hunt': !!findSound && findSound.interactiveObjects.length >= 2 && !!findSound.correctTarget,
    'find-in-scene': !!findScene && findScene.interactiveObjects.length >= 1,
    'prediction': !!prediction && prediction.interactiveObjects.length >= 2,
    'word-builder': !!builder && builder.interactiveObjects.length >= 2,
  };
}

function mechanicToBeat(kind: MechanicKind, manifest: StoryInteractionManifest): StoryInteractionBeat | null {
  const map: Record<MechanicKind, StoryInteractionBeat | undefined> = {
    'sound-hunt': manifest.beats.find((beat) => beat.mechanicType === 'find-sound'),
    'find-in-scene': manifest.beats.find((beat) => beat.mechanicType === 'find-it-in-scene'),
    'prediction': manifest.beats.find((beat) => beat.mechanicType === 'what-happens-next'),
    'word-builder': manifest.beats.find((beat) => beat.mechanicType === 'word-builder'),
  };
  return map[kind] ?? null;
}

/** Build the concrete list of SessionBeats for one Daily Adventure. The
 *  literacy/story spine is fixed (welcome, reading clusters, ending); the
 *  three interaction slots between reading clusters are filled from a
 *  composed mechanic sequence — see lib/session-composer.ts. `recentSessions`
 *  is the anti-repetition memory (yesterday first); the caller loads it from
 *  `loadRecentSessionMechanics(uid)` and, after the session actually starts,
 *  records the plan with `recordSessionMechanics(uid, sequence)`. */
export function buildSessionPlan(
  chapter: Chapter,
  childName: string,
  previousTeaser = '',
  interactionManifest: StoryInteractionManifest = buildStoryInteractionManifest(chapter),
  recentSessions: MechanicKind[][] = [],
): SessionBeat[] {
  const count = chapter.pages.length;
  const soundAfter = Math.max(0, Math.min(count - 2, Math.floor(count / 3) - 1));
  const predictionAfter = Math.max(soundAfter + 1, Math.min(count - 2, Math.floor((count * 2) / 3) - 1));
  const builderAfter = Math.max(predictionAfter + 1, count - 2);
  const interactionAnchors: number[] = [soundAfter, predictionAfter, builderAfter];
  const clusters = [
    [...Array(soundAfter + 1)].map((_, index) => index),
    [...Array(predictionAfter - soundAfter)].map((_, index) => soundAfter + 1 + index),
    [...Array(builderAfter - predictionAfter)].map((_, index) => predictionAfter + 1 + index),
    [...Array(count - builderAfter - 1)].map((_, index) => builderAfter + 1 + index),
  ].filter((cluster) => cluster.length);

  const available = mechanicsAvailableIn(interactionManifest);
  const composition = composeSession({ chapterId: chapter.id, available, recent: recentSessions });
  const sequence = composition.sequence;

  const beats: SessionBeat[] = [{
    id: 'welcome', kind: 'welcome',
    spokenLine: previousTeaser
      ? `Welcome back, ${childName}. Last time, ${previousTeaser} Let’s see what happens now.`
      : `Welcome, ${childName}. Today, ${chapter.character} has a new mystery for us.`,
  }];

  // We render each interaction after the reading cluster that ends at the
  // corresponding anchor page. `clusters` already produces up to four
  // clusters; the first three anchors line up with the sound/prediction/
  // builder positions the manifest was authored around, and the mechanic
  // at each position now comes from the composed sequence.
  const clusterAnchors = clusters.map((cluster) => cluster.at(-1)!);
  clusters.forEach((pageIndexes, index) => {
    beats.push({ id: `reading-${index + 1}`, kind: 'reading', pageIndexes, finalChallenge: index === clusters.length - 1 });
    const anchorIndex = interactionAnchors.indexOf(clusterAnchors[index]);
    if (anchorIndex < 0 || anchorIndex >= sequence.length) return;
    const mechanic = sequence[anchorIndex];
    const activity = mechanicToBeat(mechanic, interactionManifest);
    if (!activity) return;
    const kind: Extract<SessionBeat, { kind: MechanicKind }>['kind'] = mechanic;
    beats.push({ id: mechanic, kind, afterPage: pageIndexes.at(-1)!, activity } as SessionBeat);
  });
  beats.push({ id: 'ending', kind: 'ending' });
  return beats;
}

export function interactionAfterPage(plan: SessionBeat[], pageIndex: number): Extract<SessionBeat, { kind: 'sound-hunt' | 'find-in-scene' | 'prediction' | 'word-builder' }> | null {
  return plan.find((beat): beat is Extract<SessionBeat, { kind: 'sound-hunt' | 'find-in-scene' | 'prediction' | 'word-builder' }> =>
    (beat.kind === 'sound-hunt' || beat.kind === 'find-in-scene' || beat.kind === 'prediction' || beat.kind === 'word-builder') && beat.afterPage === pageIndex,
  ) ?? null;
}

/** Claims completion once so persistence and parent follow-up cannot repeat. */
export function claimEndingCompletion(latch: { current: boolean }): boolean {
  if (latch.current) return false;
  latch.current = true;
  return true;
}
