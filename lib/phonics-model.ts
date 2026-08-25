import { wordBuilderPieces } from './story-interactions.ts';

export interface PhonicsModelSegment { text: string; purpose: 'instruction' | 'word-blend' | 'phoneme-model' | 'retry' }

function elongatedSound(grapheme: string): string {
  if (grapheme === 'sh') return 'shhhh';
  if (grapheme === 's') return 'ssss';
  if (grapheme === 'm') return 'mmmm';
  if (grapheme === 'th') return 'thhhh';
  return grapheme;
}

export function modelWordThroughSound(word: string, target: string): PhonicsModelSegment[] {
  const clean = word.toLowerCase().replace(/[^a-z']/g, '');
  const index = clean.indexOf(target.toLowerCase());
  const emphasized = elongatedSound(target);
  const modeled = index >= 0
    ? `${clean.slice(0, index)}${emphasized}-${clean.slice(index + target.length)}`.replace(/^-|-$/g, '')
    : clean;
  return [
    { text: 'Listen.', purpose: 'instruction' },
    { text: modeled, purpose: 'phoneme-model' },
    { text: clean, purpose: 'word-blend' },
    { text: `Hear the ${target} sound in ${clean}?`, purpose: 'instruction' },
  ];
}

export function correctionModel(word: string, target: string): PhonicsModelSegment[] {
  const pieces = wordBuilderPieces(word);
  const targetPiece = pieces.find((piece) => piece.includes(target)) ?? target;
  return [
    { text: `This word is ${word}.`, purpose: 'instruction' },
    { text: `Listen to the beginning in ${word}.`, purpose: 'instruction' },
    { text: `${elongatedSound(targetPiece)}-${word.slice(targetPiece.length)}`, purpose: 'phoneme-model' },
    { text: word, purpose: 'word-blend' },
    { text: 'Your turn.', purpose: 'retry' },
  ];
}
