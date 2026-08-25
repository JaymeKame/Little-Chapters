import type { Chapter } from './chapters';
import { buildStoryInteractionManifest, type StoryInteractionBeat, type StoryInteractionManifest } from './story-interactions.ts';

export type SessionBeat =
  | { id: 'welcome'; kind: 'welcome'; spokenLine: string }
  | { id: string; kind: 'reading'; pageIndexes: number[]; finalChallenge: boolean }
  | { id: 'sound-hunt'; kind: 'sound-hunt'; afterPage: number; activity: StoryInteractionBeat }
  | { id: 'prediction'; kind: 'prediction'; afterPage: number; activity: StoryInteractionBeat }
  | { id: 'word-builder'; kind: 'word-builder'; afterPage: number; activity: StoryInteractionBeat }
  | { id: 'ending'; kind: 'ending' };

export interface SoundHunt { pattern: string; prompt: string; choices: [string, string, string]; answer: string }

export function buildSoundHunt(chapter: Chapter): SoundHunt {
  const beat = buildStoryInteractionManifest(chapter).beats.find((item) => item.mechanicType === 'find-sound')!;
  return { pattern: beat.literacyTarget!, prompt: beat.spokenInstruction, choices: beat.interactiveObjects.map((item) => item.label) as [string, string, string], answer: beat.correctTarget! };
}

export function buildSessionPlan(chapter: Chapter, childName: string, previousTeaser = '', interactionManifest: StoryInteractionManifest = buildStoryInteractionManifest(chapter)): SessionBeat[] {
  const count = chapter.pages.length;
  const soundAfter = Math.max(0, Math.min(count - 2, Math.floor(count / 3) - 1));
  const predictionAfter = Math.max(soundAfter + 1, Math.min(count - 2, Math.floor((count * 2) / 3) - 1));
  const builderAfter = Math.max(predictionAfter + 1, count - 2);
  const clusters = [
    [...Array(soundAfter + 1)].map((_, index) => index),
    [...Array(predictionAfter - soundAfter)].map((_, index) => soundAfter + 1 + index),
    [...Array(builderAfter - predictionAfter)].map((_, index) => predictionAfter + 1 + index),
    [...Array(count - builderAfter - 1)].map((_, index) => builderAfter + 1 + index),
  ].filter((cluster) => cluster.length);
  const beats: SessionBeat[] = [{
    id: 'welcome', kind: 'welcome',
    spokenLine: previousTeaser
      ? `Welcome back, ${childName}. Last time, ${previousTeaser} Let’s see what happens now.`
      : `Welcome, ${childName}. Today, ${chapter.character} has a new mystery for us.`,
  }];
  clusters.forEach((pageIndexes, index) => {
    beats.push({ id: `reading-${index + 1}`, kind: 'reading', pageIndexes, finalChallenge: index === clusters.length - 1 });
    const last = pageIndexes.at(-1)!;
    if (last === soundAfter) beats.push({ id: 'sound-hunt', kind: 'sound-hunt', afterPage: last, activity: interactionManifest.beats.find((beat) => beat.mechanicType === 'find-sound')! });
    if (last === predictionAfter) beats.push({ id: 'prediction', kind: 'prediction', afterPage: last, activity: interactionManifest.beats.find((beat) => beat.mechanicType === 'what-happens-next')! });
    if (pageIndexes.includes(builderAfter)) beats.push({ id: 'word-builder', kind: 'word-builder', afterPage: builderAfter, activity: interactionManifest.beats.find((beat) => beat.mechanicType === 'word-builder')! });
  });
  beats.push({ id: 'ending', kind: 'ending' });
  return beats;
}

export function interactionAfterPage(plan: SessionBeat[], pageIndex: number): Extract<SessionBeat, { kind: 'sound-hunt' | 'prediction' | 'word-builder' }> | null {
  return plan.find((beat): beat is Extract<SessionBeat, { kind: 'sound-hunt' | 'prediction' | 'word-builder' }> =>
    (beat.kind === 'sound-hunt' || beat.kind === 'prediction' || beat.kind === 'word-builder') && beat.afterPage === pageIndex,
  ) ?? null;
}

/** Claims completion once so persistence and parent follow-up cannot repeat. */
export function claimEndingCompletion(latch: { current: boolean }): boolean {
  if (latch.current) return false;
  latch.current = true;
  return true;
}
