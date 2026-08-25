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

const FALLBACKS: Record<TutorIntent, Array<(context: TutorContext) => string>> = {
  WELCOME: [(c) => `Ready for today’s adventure, ${c.childName ?? 'reader'}?`, (c) => `I’m glad you’re here, ${c.childName ?? 'reader'}. Let’s open the story.`],
  STORY_CALLBACK: [(c) => `Last time, ${c.storyBeat ?? 'our adventure had just begun'}. Let’s see what happens.`],
  EASY_SUCCESS: [() => 'You made that sound easy.', () => 'That reading moved the story along.'],
  EFFORTFUL_SUCCESS: [() => 'You stayed with it and found the word.', () => 'That was careful reading. You did it.'],
  RECOVERY_SUCCESS: [() => 'You listened, tried again, and got it.', () => 'That second try unlocked it.'],
  GENTLE_RETRY: [(c) => `Let’s listen closely to ${c.word ?? 'that word'}.`, () => 'Almost. Let’s build it together.'],
  MODEL_WORD: [(c) => `This word is ${c.word ?? 'the story word'}.`, (c) => `Listen to the whole word: ${c.word ?? ''}.`],
  MODEL_SOUND: [(c) => `Listen to the beginning in ${c.word ?? 'the word'}: ${c.sound ?? ''}.`],
  INVITE_RETRY: [() => 'Your turn.', () => 'Now you try it.'],
  SILENCE_NUDGE: [() => 'Take your time. I’m listening.', () => 'The story is waiting whenever you’re ready.'],
  STORY_CURIOSITY: [(c) => `I wonder what ${c.storyBeat ?? 'the story'} will reveal next.`, () => 'Something in this scene is about to change.'],
  PREDICTION_RESPONSE: [(c) => `Ooh, ${c.prediction ?? 'that'} could happen. Let’s see.`, () => 'That’s an interesting idea. Watch what the story does.'],
  WORD_GAME_TRANSITION: [() => 'A story word is ready to help us.', () => 'This word can make something happen.'],
  STORY_REVEAL: [(c) => `${c.storyBeat ?? 'The clue'} appears!`, () => 'Look—the world changed.'],
  FINAL_CELEBRATION: [(c) => `You brought the story to its ending, ${c.childName ?? 'reader'}!`, () => 'You read the adventure all the way through.'],
  GOODBYE: [() => 'Your next chapter will be waiting tomorrow.', () => 'Rest the storybook here. We’ll continue tomorrow.'],
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

