import type { Chapter } from './chapters';

export type SessionBeat =
  | { id: 'welcome'; kind: 'welcome'; spokenLine: string }
  | { id: string; kind: 'reading'; pageIndexes: number[]; finalChallenge: boolean }
  | { id: 'sound-hunt'; kind: 'sound-hunt'; afterPage: number; activity: SoundHunt }
  | { id: 'prediction'; kind: 'prediction'; afterPage: number; choices: [string, string] }
  | { id: 'ending'; kind: 'ending' };

export interface SoundHunt { pattern: string; prompt: string; choices: [string, string, string]; answer: string }

function words(chapter: Chapter): string[] {
  return [...new Set(chapter.pages.flatMap((page) => page.text.toLowerCase().match(/[a-z']+/g) ?? []))];
}

export function buildSoundHunt(chapter: Chapter): SoundHunt {
  const all = words(chapter);
  const group = chapter.phonics.find((item) => item.words.some((word) => all.includes(word.toLowerCase())));
  const answer = group?.words.find((word) => all.includes(word.toLowerCase()))?.toLowerCase()
    ?? chapter.pages.flatMap((page) => page.focusWords)[0]?.toLowerCase() ?? all.find((word) => word.length > 2) ?? 'story';
  const hinted = group?.hint.toLowerCase().match(/[a-z]+/)?.[0] ?? answer.slice(0, Math.min(2, answer.length));
  const pattern = answer.includes(hinted) ? hinted : answer.slice(0, 1);
  const distractors = all.filter((word) => word !== answer && word.length > 2 && !word.includes(pattern)).slice(0, 2);
  const fallbacks = ['story', 'little', 'today'].filter((word) => word !== answer && !word.includes(pattern));
  while (distractors.length < 2) distractors.push(fallbacks[distractors.length] ?? `word${distractors.length + 1}`);
  const choices = [answer, ...distractors] as [string, string, string];
  // Stable rotation prevents the answer always occupying the first position.
  choices.push(choices.shift()!);
  return { pattern, prompt: `Which story word has the ${pattern} sound?`, choices, answer };
}

export function buildSessionPlan(chapter: Chapter, childName: string, previousTeaser = ''): SessionBeat[] {
  const count = chapter.pages.length;
  const soundAfter = Math.max(0, Math.min(count - 2, Math.floor(count / 3) - 1));
  const predictionAfter = Math.max(soundAfter + 1, Math.min(count - 2, Math.floor((count * 2) / 3) - 1));
  const clusters = [
    [...Array(soundAfter + 1)].map((_, index) => index),
    [...Array(predictionAfter - soundAfter)].map((_, index) => soundAfter + 1 + index),
    [...Array(count - predictionAfter - 1)].map((_, index) => predictionAfter + 1 + index),
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
    if (last === soundAfter) beats.push({ id: 'sound-hunt', kind: 'sound-hunt', afterPage: last, activity: buildSoundHunt(chapter) });
    if (last === predictionAfter) beats.push({ id: 'prediction', kind: 'prediction', afterPage: last, choices: ['A hidden clue appears', `${chapter.character} hears something nearby`] });
  });
  beats.push({ id: 'ending', kind: 'ending' });
  return beats;
}

export function interactionAfterPage(plan: SessionBeat[], pageIndex: number): Extract<SessionBeat, { kind: 'sound-hunt' | 'prediction' }> | null {
  return plan.find((beat): beat is Extract<SessionBeat, { kind: 'sound-hunt' | 'prediction' }> =>
    (beat.kind === 'sound-hunt' || beat.kind === 'prediction') && beat.afterPage === pageIndex,
  ) ?? null;
}

/** Claims completion once so persistence and parent follow-up cannot repeat. */
export function claimEndingCompletion(latch: { current: boolean }): boolean {
  if (latch.current) return false;
  latch.current = true;
  return true;
}
