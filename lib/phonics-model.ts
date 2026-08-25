import { wordBuilderPieces } from './story-interactions.ts';

export interface PhonicsModelSegment {
  text: string;
  purpose: 'instruction' | 'word-blend' | 'phoneme-model' | 'retry' | 'onset' | 'rime';
  /** Optional per-segment hold (ms) AFTER the segment finishes speaking. If
   *  omitted, audio-session.ts uses its purpose-based default. Correction sprint
   *  Section 7: phoneme modeling / onset+rime beats need real listening time. */
  holdMs?: number;
}

/** Consonant / digraph modeling — child needs enough acoustic time to perceive
 *  the sound. This is the ONE place where the phoneme is stretched; every other
 *  spoken segment is a real word or sentence so the pipeline never voices a
 *  bare phoneme in the middle of instructional text.
 *  Correction sprint Section 7: pacing lives in `holdMs` on the segment, not
 *  in a global TTS slowdown. */
function elongatedSound(grapheme: string): string {
  const g = grapheme.toLowerCase();
  if (g === 'sh') return 'shhhh';
  if (g === 'ch') return 'ch-ch-ch';
  if (g === 'th') return 'thhhh';
  if (g === 'wh') return 'whhhh';
  if (g === 's') return 'ssss';
  if (g === 'z') return 'zzzz';
  if (g === 'f') return 'ffff';
  if (g === 'v') return 'vvvv';
  if (g === 'm') return 'mmmm';
  if (g === 'n') return 'nnnn';
  if (g === 'l') return 'llll';
  if (g === 'r') return 'rrrr';
  // Stops (p/t/k/b/d/g) don't stretch — repeat them to give listening time
  // instead of a bogus vowel tail.
  if (/^[ptkbdg]$/.test(g)) return `${g}-${g}-${g}`;
  // Short vowels: hold the vowel a beat.
  if (/^[aeiou]$/.test(g)) return `${g}${g}${g}`;
  return g;
}

/** Split a word into an onset (leading consonant/consonant-cluster/digraph)
 *  and a rime (the vowel + trailing consonants) — so "ship" → ["sh", "ip"],
 *  "cat" → ["c", "at"]. Never returns empty pieces. */
function onsetRime(word: string): { onset: string; rime: string } {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  const pieces = wordBuilderPieces(clean);
  if (pieces.length < 2) return { onset: pieces[0] ?? clean, rime: '' };
  const onset = pieces[0];
  const rime = pieces.slice(1).join('');
  return { onset, rime };
}

/** Sound-hunt initial modeling: anchor the target sound INSIDE a real word,
 *  with a stretched onset and generous listening pauses. Never voices a bare
 *  phoneme in isolation — the whole word is always the acoustic anchor. */
export function modelWordThroughSound(word: string, target: string): PhonicsModelSegment[] {
  const clean = word.toLowerCase().replace(/[^a-z']/g, '');
  const { onset, rime } = onsetRime(clean);
  // Prefer stretching the actual onset when the requested target matches (or
  // is contained in) it — that is the sound the child needs to perceive first.
  const digraph = onset === target.toLowerCase() || onset.startsWith(target.toLowerCase()) ? onset : target;
  const stretched = elongatedSound(digraph);
  return [
    { text: 'Listen.', purpose: 'instruction', holdMs: 380 },
    { text: `${stretched}...`, purpose: 'phoneme-model', holdMs: 520 },
    { text: rime ? `${rime}.` : clean, purpose: 'rime', holdMs: 420 },
    { text: `${clean}.`, purpose: 'word-blend', holdMs: 460 },
    { text: `Hear the ${target} at the beginning?`, purpose: 'instruction', holdMs: 220 },
  ];
}

/** Wrong-word correction — the stable pedagogical structure:
 *  1. IDENTIFY correct word ("This word is shut.")
 *  2. MODEL whole word (implicit — the sentence in step 1 says it)
 *  3. EMPHASIZE relevant sound within word ("Listen to the beginning.")
 *  4. Sound + rime with real pauses
 *  5. MODEL whole word AGAIN
 *  6. INVITE child to try ("Your turn.")
 *  Correction sprint Section 8. */
export function correctionModel(word: string, target: string): PhonicsModelSegment[] {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  const { onset, rime } = onsetRime(clean);
  const digraph = target && (onset === target.toLowerCase() || onset.startsWith(target.toLowerCase())) ? onset : (target || onset);
  const stretched = elongatedSound(digraph);
  return [
    { text: `This word is ${clean}.`, purpose: 'instruction', holdMs: 420 },
    { text: 'Listen to the beginning.', purpose: 'instruction', holdMs: 340 },
    { text: `${stretched}...`, purpose: 'phoneme-model', holdMs: 520 },
    { text: rime ? `${rime}.` : clean, purpose: 'rime', holdMs: 420 },
    { text: `${clean}.`, purpose: 'word-blend', holdMs: 500 },
    { text: 'Your turn.', purpose: 'retry', holdMs: 240 },
  ];
}

/** Word Builder: chunk-by-chunk modeling before the child assembles the word.
 *  Every piece is modeled with its own hold so the child can associate the
 *  sound with the visible piece — then the joined word is modeled once. */
export function wordBuilderChunkModel(pieces: string[]): PhonicsModelSegment[] {
  const segments: PhonicsModelSegment[] = pieces.map((piece): PhonicsModelSegment => ({
    text: `${elongatedSound(piece)}...`,
    purpose: 'phoneme-model',
    holdMs: 460,
  }));
  segments.push({ text: pieces.join(''), purpose: 'word-blend', holdMs: 420 });
  return segments;
}
