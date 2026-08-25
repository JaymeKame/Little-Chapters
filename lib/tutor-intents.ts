export type TutorIntent =
  | 'WELCOME' | 'STORY_CALLBACK' | 'EASY_SUCCESS' | 'EFFORTFUL_SUCCESS'
  | 'RECOVERY_SUCCESS' | 'GENTLE_RETRY' | 'MODEL_WORD' | 'MODEL_SOUND'
  | 'INVITE_RETRY' | 'SILENCE_NUDGE' | 'STORY_CURIOSITY'
  | 'PREDICTION_RESPONSE' | 'WORD_GAME_TRANSITION' | 'STORY_REVEAL'
  | 'FINAL_CELEBRATION' | 'GOODBYE';

export interface TutorContext {
  childName?: string;
  word?: string;
  sound?: string;
  storyBeat?: string;
  prediction?: string;
  attemptCount?: number;
  neededHelp?: boolean;
}

/** Correction sprint Section 20: tutor SURFACE language varies, tutor FUNCTION
 *  stays stable. The name goes into WELCOME and FINAL_CELEBRATION only — a
 *  child hearing their name in every utterance quickly stops noticing it and
 *  the tutor starts sounding like a doorbell. Every other intent leans on
 *  short, warm, mechanic-appropriate phrasing that reads differently but
 *  means the same thing. Anti-repetition is enforced by TutorPhraseSession
 *  below (LRU of the last 8 lines actually spoken).                        */
const FALLBACKS: Record<TutorIntent, Array<(context: TutorContext) => string>> = {
  WELCOME: [
    (c) => `Ready for today’s adventure, ${c.childName ?? 'reader'}?`,
    (c) => `I’m glad you’re here, ${c.childName ?? 'reader'}. Let’s open the story.`,
    () => 'The next page is waiting. Ready?',
    () => 'A new page today. Let’s see where it goes.',
  ],
  STORY_CALLBACK: [
    (c) => `Last time, ${c.storyBeat ?? 'our adventure had just begun'}. Let’s see what happens.`,
    (c) => `We left off just as ${c.storyBeat ?? 'the story turned a corner'}. Ready to keep going?`,
    () => 'You know the story so far. Let’s find out what comes next.',
  ],
  EASY_SUCCESS: [
    () => 'You made that sound easy.',
    () => 'That reading moved the story along.',
    () => 'Smooth.',
    () => 'Right on the beat.',
    () => 'The story just glided forward.',
  ],
  EFFORTFUL_SUCCESS: [
    () => 'You stayed with it and found the word.',
    () => 'That was careful reading. You did it.',
    () => 'You worked that one out.',
    () => 'That was thinking-out-loud reading. Nice.',
  ],
  RECOVERY_SUCCESS: [
    () => 'You listened, tried again, and got it.',
    () => 'That second try unlocked it.',
    () => 'One more try was the trick.',
    () => 'Listening helped. That’s the word.',
  ],
  GENTLE_RETRY: [
    (c) => `Let’s listen closely to ${c.word ?? 'that word'}.`,
    () => 'Almost. Let’s build it together.',
    (c) => `Let’s sound out ${c.word ?? 'that one'} slowly.`,
    () => 'One more listen, together.',
  ],
  MODEL_WORD: [
    (c) => `This word is ${c.word ?? 'the story word'}.`,
    (c) => `Listen to the whole word: ${c.word ?? ''}.`,
    (c) => `The word is ${c.word ?? 'this one'}.`,
  ],
  MODEL_SOUND: [
    (c) => `Listen to the beginning in ${c.word ?? 'the word'}: ${c.sound ?? ''}.`,
    (c) => `Hear the ${c.sound ?? 'first'} at the start of ${c.word ?? 'this word'}?`,
    (c) => `The ${c.sound ?? 'first'} sound is inside ${c.word ?? 'the word'}.`,
  ],
  INVITE_RETRY: [
    () => 'Your turn.',
    () => 'Now you try it.',
    () => 'Give it a go.',
    () => 'Read it back to me.',
  ],
  SILENCE_NUDGE: [
    () => 'Take your time. I’m listening.',
    () => 'The story is waiting whenever you’re ready.',
    () => 'No hurry — sound it out.',
    () => 'I’m right here.',
  ],
  STORY_CURIOSITY: [
    (c) => `I wonder what ${c.storyBeat ?? 'the story'} will reveal next.`,
    () => 'Something in this scene is about to change.',
    () => 'What do you think happens now?',
    () => 'The next line might surprise us.',
  ],
  PREDICTION_RESPONSE: [
    // Correction pass 2, Section 4: the child's chosen SENTENCE is spoken
    // separately before this line — these responses stay generic on purpose
    // so we never repeat their tap-token as a bare noun.
    () => 'That could happen. Let’s see.',
    () => 'That’s an interesting idea. Watch what the story does.',
    () => 'Ooh — let’s find out.',
    () => 'Good guess. The story picks now.',
  ],
  WORD_GAME_TRANSITION: [
    () => 'A story word is ready to help us.',
    () => 'This word can make something happen.',
    () => 'Let’s put a word together.',
    () => 'Time to build a word.',
  ],
  STORY_REVEAL: [
    (c) => `${c.storyBeat ?? 'The clue'} appears!`,
    () => 'Look—the world changed.',
    () => 'There it is.',
    () => 'The scene answers back.',
  ],
  FINAL_CELEBRATION: [
    (c) => `You brought the story to its ending, ${c.childName ?? 'reader'}!`,
    () => 'You read the adventure all the way through.',
    () => 'Chapter complete. Nicely done.',
    () => 'That was a full adventure. You carried it.',
  ],
  GOODBYE: [
    () => 'Your next chapter will be waiting tomorrow.',
    () => 'Rest the storybook here. We’ll continue tomorrow.',
    () => 'Tomorrow’s page is already dreaming up something.',
    () => 'See you at the next chapter.',
  ],
};

export class TutorPhraseSession {
  private recent: string[] = [];

  line(intent: TutorIntent, context: TutorContext = {}): string {
    const candidates = FALLBACKS[intent].map((render) => render(context));
    const line = candidates.find((candidate) => !this.recent.includes(candidate)) ?? candidates[0];
    this.recent = [line, ...this.recent.filter((item) => item !== line)].slice(0, 8);
    return line;
  }
}

export function deterministicTutorLine(intent: TutorIntent, context: TutorContext = {}): string {
  return FALLBACKS[intent][0](context);
}

