/* Today's chapter — demo content until the AI chapter-writer exists.
 *
 * One five-page story arc, personalized by the child's top interest: the
 * companion character and scenery change, the phonics shape stays (short
 * sentences, decodable words, one or two focus words per page — mockup:
 * "Only one or two sentences at a time"). Each page lists focus words that
 * get highlighted in the reader and reported to the parent.                  */

import type { InterestId } from './profile';

export interface ChapterPage {
  /** 1–2 short sentences; the exact reference text the child reads. */
  text: string;
  /** Words highlighted in the reader (blue = character, green = new word). */
  focusWords: string[];
}

export interface Chapter {
  title: string;
  character: string;
  pages: ChapterPage[];
  /** Chapter-end cliffhanger lines (mockup screen 5). */
  cliffhanger: [string, string];
  /** Teaser for the parent message (mockup screen 6). */
  teaser: string;
  /** Phonics the chapter practices, for the parent report. */
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

export function chapterFor(interest: InterestId | undefined): Chapter {
  const s = SETTINGS[interest ?? 'dogs'];
  return {
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
    teaser: `${s.character} finds out what was behind the door... 🐾`,
    phonics: [
      { hint: 'sh in “shiny”', words: ['shiny'] },
      { hint: 'short vowels (a, i)', words: ['path', 'fit', 'hill'] },
      { hint: 'blends (cl, cr)', words: ['click', 'raced'] },
    ],
  };
}
