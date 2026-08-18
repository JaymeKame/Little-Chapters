import type { ChildProfile, InterestId } from './profile';
import { pickSkeleton, type Skeleton } from '../reading-tutor/src/skeletons';
import { assignSlots } from '../reading-tutor/src/slots';
import type { StoryDraft } from '../reading-tutor/src/validators';

export interface ChapterPage {
  text: string;
  focusWords: string[];
}

export interface Chapter {
  id: string;
  title: string;
  character: string;
  pages: ChapterPage[];
  cliffhanger: [string, string];
  teaser: string;
  phonics: { hint: string; words: string[] }[];
}

const SETTINGS: Record<InterestId, { character: string; place: string; spot: string }> = {
  dogs: { character: 'Rex', place: 'field', spot: 'gate' },
  space: { character: 'Zip', place: 'sky', spot: 'star' },
  dinosaurs: { character: 'Dot', place: 'swamp', spot: 'rock' },
  trains: { character: 'Chug', place: 'track', spot: 'bridge' },
  unicorns: { character: 'Luna', place: 'meadow', spot: 'well' },
  ocean: { character: 'Finn', place: 'reef', spot: 'shell' },
};

export function chapterFor(interest: InterestId | undefined, childName = 'reader'): Chapter {
  const s = SETTINGS[interest ?? 'dogs'];
  const slug = childName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'reader';
  return {
    id: `${interest ?? 'dogs'}-${slug}-${new Date().toLocaleDateString('en-CA')}`,
    title: "Today's Chapter",
    character: s.character,
    pages: [
      { text: `${s.character} raced across the ${s.place}. He saw something shiny under the ${s.spot}.`, focusWords: [s.character, s.spot] },
      { text: 'It was a little gold key. Who lost it?', focusWords: ['gold', 'key'] },
      { text: `${s.character} looked and looked. A tiny path went up the hill.`, focusWords: ['path', 'hill'] },
      { text: 'At the top was a red door. The key fit the lock. Click!', focusWords: ['door', 'lock'] },
      { text: 'The door began to open. Something was inside!', focusWords: ['open', 'inside'] },
    ],
    cliffhanger: ['The door opened... and something amazing was waiting inside.', 'To be continued tomorrow...'],
    teaser: `${s.character} finds out what was behind the door...`,
    phonics: [
      { hint: 'sh in shiny', words: ['shiny'] },
      { hint: 'short vowels', words: ['path', 'fit', 'hill'] },
      { hint: 'blends', words: ['click', 'raced'] },
    ],
  };
}

function stageForAge(age: number): number {
  return Math.min(10, Math.max(1, Math.round(age) - 4));
}

function stateKey(profile: ChildProfile): string {
  return `little-chapters-story-state:${profile.childName.trim().toLowerCase()}`;
}

function recentSkeletons(profile: ChildProfile): string[] {
  try {
    return JSON.parse(localStorage.getItem(stateKey(profile)) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function rememberSkeleton(profile: ChildProfile, id: string): void {
  try {
    const recent = [id, ...recentSkeletons(profile).filter((item) => item !== id)].slice(0, 4);
    localStorage.setItem(stateKey(profile), JSON.stringify(recent));
  } catch {
    /* best-effort rotation memory */
  }
}

export function tutorStoryContext(profile: ChildProfile): { stage: number; skeleton: Skeleton } {
  const stage = stageForAge(profile.age);
  return { stage, skeleton: pickSkeleton(stage, recentSkeletons(profile)) };
}

export function adaptTutorDraft(profile: ChildProfile, draft: StoryDraft, skeleton: Skeleton): Chapter {
  const stage = stageForAge(profile.age);
  rememberSkeleton(profile, skeleton.id);
  const base = chapterFor(profile.interests[0], profile.childName);
  return {
    ...base,
    pages: draft.sentences.map((text) => ({ text, focusWords: [] })),
    cliffhanger: [draft.sentences.at(-1) ?? skeleton.cliffhangerNote, 'To be continued tomorrow...'],
    teaser: draft.summaryLine || `${profile.childName} has more to discover tomorrow...`,
    phonics: [{ hint: `Stage ${stage} practice`, words: Object.values(assignSlots(skeleton.beats, stage)) }],
  };
}

export async function requestTutorChapter(profile: ChildProfile): Promise<Chapter | null> {
  const context = tutorStoryContext(profile);
  try {
    const response = await fetch('/api/chapters/story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, stage: context.stage, skeletonId: context.skeleton.id }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { draft?: StoryDraft; skeleton?: Skeleton };
    return data.draft && data.skeleton ? adaptTutorDraft(profile, data.draft, data.skeleton) : null;
  } catch {
    return null;
  }
}
