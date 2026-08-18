/* Parent message generator following parent-sms.spec.md guidelines */

export interface ReadingSessionData {
  childName: string;
  newWords: string[]; // Words read correctly for the first time
  practicedWords: { word: string; hint: string }[]; // Words that were tricky
  mostlyAssisted: boolean; // Whether the child was mostly read to
  tomorrowTeaser: string; // Brief description of tomorrow's chapter
}

export interface GeneratedMessage {
  lines: string[];
  rawMessage: string;
}

const TIMELINE_MESSAGES = [
  'These take weeks to stick, and that\'s normal.',
  'Progress like this is normal and expected.',
  'This pace is exactly what we look for.',
  'Weeks of practice like this add up.',
];

const TRICKY_SOUNDS = [
  'Still working on some sounds.',
  'A few sounds are still tricky.',
  'Some sounds need more practice.',
  'Still practicing a few sounds.',
];

function getRandomItem<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

export function generateParentMessage(data: ReadingSessionData): GeneratedMessage {
  const lines: string[] = [];

  // Line 1: The specific win
  if (data.mostlyAssisted) {
    // Mostly assisted night: focus on finishing the chapter
    lines.push(`${data.childName} finished the chapter and heard what happened.`);
  } else if (data.newWords.length > 0) {
    // Has first-time wins: pick one specific word
    const winWord = data.newWords[0];
    lines.push(`${data.childName} read "${winWord}" on their own for the first time tonight.`);
  } else {
    // No first-time wins but not mostly assisted: strongest thing that happened
    if (data.practicedWords.length > 0) {
      const practicedWord = data.practicedWords[0].word;
      lines.push(`${data.childName} worked hard on "${practicedWord}" tonight.`);
    } else {
      lines.push(`${data.childName} kept reading through the whole chapter.`);
    }
  }

  // Line 2: Sounds still tricky (if any)
  if (data.practicedWords.length > 0 && !data.mostlyAssisted) {
    lines.push(getRandomItem(TRICKY_SOUNDS));
  }

  // Line 3: Timeline normalisation (REQUIRED in every message)
  lines.push(getRandomItem(TIMELINE_MESSAGES));

  // Line 4: What's coming tomorrow
  lines.push(`Tomorrow: ${data.tomorrowTeaser}`);

  const rawMessage = lines.join('\n');

  return { lines, rawMessage };
}
