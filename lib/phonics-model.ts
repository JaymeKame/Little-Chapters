import { wordBuilderPieces } from './story-interactions.ts';

export interface PhonicsModelSegment {
  text: string;
  purpose: 'instruction' | 'word-blend' | 'phoneme-model' | 'retry' | 'onset' | 'rime' | 'reference-word';
  /** Optional per-segment hold (ms) AFTER the segment finishes speaking. If
   *  omitted, audio-session.ts uses its purpose-based default. Second
   *  correction pass: pedagogy leans on real reference WORDS instead of a
   *  stretched isolated phoneme, so pacing lives on the words. */
  holdMs?: number;
}

/** One semantic tutor turn is synthesized once. Segment arrays remain useful
 * for pedagogical structure tests, while this preserves punctuation/prosody
 * and prevents a network fetch plus music duck cycle between every word. */
export function semanticTurnText(segments: readonly PhonicsModelSegment[]): string {
  return segments.map((segment) => segment.text.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** Correction pass 2, Section 1: two-to-three developmentally appropriate
 *  example words per phonics family, chosen for recognizability at age ~5 and
 *  for unambiguous shared beginning sounds. Never asks the LLM to improvise;
 *  never depends on a naked TTS phoneme. Lookup is case-insensitive and
 *  tolerant of decorated targets ("sh in ship" → uses the "sh" bucket).
 *  Consumers ALWAYS get at least the target word back so a novel or
 *  non-curated family degrades gracefully. */
const REFERENCE_WORDS: Record<string, readonly string[]> = {
  // digraphs
  sh: ['ship', 'shoe', 'shut', 'shop'],
  ch: ['chair', 'cheese', 'chip'],
  th: ['thumb', 'three', 'think'],
  wh: ['whale', 'wheel', 'whisper'],
  ph: ['phone', 'photo'],
  ck: ['duck', 'sock', 'clock'],
  ng: ['ring', 'wing', 'song'],
  // stops + fricatives + nasals
  s: ['sun', 'sock', 'seven'],
  z: ['zip', 'zebra'],
  f: ['fish', 'four', 'foot'],
  v: ['van', 'vine', 'violet'],
  m: ['moon', 'mouse', 'monkey'],
  n: ['nest', 'nose', 'night'],
  p: ['pig', 'pan', 'panda'],
  t: ['toe', 'tent', 'top'],
  k: ['kite', 'king', 'key'],
  c: ['cat', 'cup', 'car'],
  b: ['boy', 'box', 'ball'],
  d: ['dog', 'duck', 'door'],
  g: ['goat', 'girl', 'gate'],
  l: ['lion', 'lamp', 'leaf'],
  r: ['rain', 'red', 'run'],
  h: ['hat', 'hop', 'hand'],
  j: ['jump', 'juice', 'jam'],
  y: ['yellow', 'yak', 'yes'],
  w: ['wind', 'water', 'wagon'],
  q: ['queen', 'quick', 'quilt'],
  x: ['box', 'fox', 'six'],
  // short vowels
  a: ['apple', 'ant', 'ax'],
  e: ['egg', 'elbow', 'elephant'],
  i: ['igloo', 'insect', 'inch'],
  o: ['octopus', 'ox', 'olive'],
  u: ['umbrella', 'up', 'under'],
  // common early blends
  st: ['star', 'stop', 'stick'],
  sn: ['snake', 'snow', 'sneeze'],
  sl: ['slide', 'sleep', 'slug'],
  sp: ['spoon', 'spider', 'spot'],
  sc: ['scarf', 'scoot'],
  sk: ['skate', 'skip'],
  sm: ['smile', 'small'],
  sw: ['swim', 'swan'],
  cl: ['clap', 'cloud', 'clock'],
  cr: ['crab', 'crown'],
  bl: ['blue', 'block', 'blanket'],
  br: ['bread', 'brown'],
  dr: ['dragon', 'drum'],
  fl: ['flag', 'flower'],
  fr: ['frog', 'friend'],
  gl: ['glass', 'glue'],
  gr: ['grass', 'green'],
  pl: ['plate', 'plum'],
  pr: ['prince', 'pretzel'],
  tr: ['tree', 'train', 'truck'],
};

/** Normalize a chapter's "hint" or literacy target into a family key.
 *  Accepts either a bare grapheme ("sh"), a decorated phrase ("sh in ship",
 *  "short vowels"), a chapter phonics.hint, or the raw storyEntities label. */
function normalizeFamilyKey(rawTarget: string): string {
  const lower = (rawTarget || '').toLowerCase().trim();
  if (!lower) return '';
  // "sh in ship" / "th in thumb" / "short vowels"
  const inMatch = lower.match(/^([a-z]{1,3})\s+in\b/);
  if (inMatch) return inMatch[1];
  if (/short\s+vowels?/.test(lower)) return 'a';
  if (/blends?/.test(lower)) return 'st';
  // "sh", "st", "s"
  const short = lower.match(/^[a-z]{1,3}$/)?.[0];
  if (short) return short;
  // Any single starting letters we can extract.
  return lower.match(/[a-z]+/)?.[0]?.slice(0, 3) ?? '';
}

/** 2–3 reference words that unambiguously start with the target sound,
 *  filtered against any words the caller already knows are on-screen (to
 *  avoid giving away the target answer as a reference). If the curated list
 *  can't supply enough non-conflicting words, the target itself is used as a
 *  final anchor so the sequence never runs empty. */
export function referenceWordsForFamily(rawTarget: string, exclude: readonly string[] = []): string[] {
  const key = normalizeFamilyKey(rawTarget);
  const excludeLower = new Set(exclude.map((word) => word.toLowerCase()));
  const curated = (REFERENCE_WORDS[key] ?? []).filter((word) => !excludeLower.has(word.toLowerCase()));
  if (curated.length >= 2) return curated.slice(0, 3);
  // Not enough curated matches — fall back to any word from the target's
  // family plus (as a last resort) generic sound-alike words. Never returns
  // an empty list.
  if (curated.length === 1) return curated;
  // Try the raw target as a starter word if it looks like a real word.
  const cleanTarget = rawTarget.toLowerCase().replace(/[^a-z]/g, '');
  if (cleanTarget && cleanTarget.length >= 2 && !excludeLower.has(cleanTarget)) return [cleanTarget];
  return [];
}

/** Sound-hunt initial modeling (Correction pass 2, Section 1).
 *
 *  Pedagogy: the target sound is TAUGHT through 2–3 concrete example WORDS,
 *  not through a stretched isolated phoneme. Physical testing showed that a
 *  five-year-old cannot reliably tell a naked TTS /th/ apart from /f/ on
 *  small speakers — but "thumb… think… three" is unambiguous.
 *
 *  Sequence shape:
 *    1. "Listen to these words."
 *    2. reference word 1
 *    3. reference word 2
 *    4. reference word 3 (optional)
 *    5. "Listen to how they begin."
 *    6. "Which story word starts the same way?"
 *
 *  Every segment carries a real hold so the child has time to perceive the
 *  onset (see speakSequence in lib/audio-session.ts). The target word is
 *  always the reference-word list's exclude filter so the tutor never
 *  gives away the answer inside a reference. */
export function modelWordThroughSound(word: string, target: string): PhonicsModelSegment[] {
  const clean = (word || '').toLowerCase().replace(/[^a-z']/g, '');
  const references = referenceWordsForFamily(target, clean ? [clean] : []);
  if (references.length === 0 && !clean) {
    return [
      { text: 'Listen to the story word.', purpose: 'instruction', holdMs: 320 },
      { text: 'Which one begins the same way?', purpose: 'instruction', holdMs: 200 },
    ];
  }
  const segments: PhonicsModelSegment[] = [];
  segments.push({ text: 'Listen to these words.', purpose: 'instruction', holdMs: 340 });
  for (const reference of references) {
    segments.push({ text: `${reference}...`, purpose: 'reference-word', holdMs: 460 });
  }
  segments.push({ text: 'Listen to how they begin.', purpose: 'instruction', holdMs: 340 });
  segments.push({ text: 'Which story word starts the same way?', purpose: 'instruction', holdMs: 220 });
  return segments;
}

/** Post-success reinforcement: only after the child has matched the shared
 * beginning do we name/model the sound, always anchored by the whole word and
 * never rendered or spoken with slash notation. */
export function successSoundModel(word: string, target: string): PhonicsModelSegment[] {
  const clean = (word || '').toLowerCase().replace(/[^a-z']/g, '');
  const family = normalizeFamilyKey(target);
  if (!clean) return [{ text: 'Yes. You matched the beginning.', purpose: 'instruction', holdMs: 240 }];
  const modeled = elongatedSound(family);
  return [
    { text: `Yes — ${clean}.`, purpose: 'instruction', holdMs: 320 },
    { text: `${clean} starts with ${modeled}.`, purpose: 'phoneme-model', holdMs: 420 },
    { text: `${modeled}... ${clean}.`, purpose: 'word-blend', holdMs: 420 },
  ];
}

/** Wrong-word correction (Correction pass 2, Section 3).
 *
 *  Pedagogical sequence (stable meaning, warm phrasing):
 *    1. IDENTIFY the child's choice ("That's rex.")
 *    2. INVITE re-listening ("Listen again.")
 *    3. MODEL a known reference word ("thumb...")
 *    4. MODEL the target word ("thump.")
 *    5. COMPARE ("Hear how those start the same?")
 *    6. RETRY ("Try one more time.")
 *
 *  Never speaks a naked phoneme. Never uses phonetic notation. Never says
 *  "wrong". `childChoice` may be empty (some entry points don't know which
 *  tile was tapped) — the sequence then skips the identification line.
 *  `target` is the FAMILY key (or literacy target); `word` is the story
 *  word the child was supposed to find. */
export function correctionModel(word: string, target: string, childChoice = ''): PhonicsModelSegment[] {
  const cleanTarget = (word || '').toLowerCase().replace(/[^a-z]/g, '');
  const cleanChoice = (childChoice || '').toLowerCase().replace(/[^a-z]/g, '');
  const references = referenceWordsForFamily(target, cleanTarget ? [cleanTarget] : []);
  const anchor = references[0];
  const segments: PhonicsModelSegment[] = [];
  if (cleanChoice && cleanChoice !== cleanTarget) {
    segments.push({ text: `That's ${cleanChoice}.`, purpose: 'instruction', holdMs: 380 });
  }
  segments.push({ text: 'Listen again.', purpose: 'instruction', holdMs: 320 });
  if (anchor) segments.push({ text: `${anchor}...`, purpose: 'reference-word', holdMs: 460 });
  if (cleanTarget) segments.push({ text: `${cleanTarget}.`, purpose: 'word-blend', holdMs: 460 });
  if (anchor) segments.push({ text: 'Hear how those start the same?', purpose: 'instruction', holdMs: 320 });
  segments.push({ text: 'Try one more time.', purpose: 'retry', holdMs: 240 });
  return segments;
}

// Legacy helpers retained for word-builder chunk audio: `wordBuilderPieces`
// still segments a whole target word by graphemes; those chunks are still
// modeled one at a time before the child assembles the word.
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
  if (/^[ptkbdg]$/.test(g)) return `${g}-${g}-${g}`;
  if (/^[aeiou]$/.test(g)) return `${g}${g}${g}`;
  return g;
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

/** Conservative worst-case estimate of how long `speakSequence(segments)`
 *  should take (ms). Used by /read as the ceiling for its interaction-ready
 *  watchdog — if the sequence's `onEnd` never fires within
 *  `estimateSequenceDurationMs(segments) + safety`, the UI unlocks anyway so
 *  a child is never trapped by an unreliable Safari/iPad speech callback.
 *
 *  Heuristic: per segment take the max of a 1200 ms TTS startup floor and
 *  ~65 ms per character, plus the segment's declared holdMs (or a purpose-
 *  based default), plus 300 ms of overhead. Overestimating is the safe
 *  direction — a healthy path always completes well inside it. */
export function estimateSequenceDurationMs(segments: PhonicsModelSegment[]): number {
  let total = 0;
  for (const segment of segments) {
    const chars = (segment.text ?? '').length;
    const spoken = Math.max(1200, chars * 65);
    const purposeHold = segment.purpose === 'phoneme-model'
      ? 440
      : segment.purpose === 'onset' || segment.purpose === 'rime' || segment.purpose === 'reference-word'
        ? 380
        : segment.purpose === 'word-blend'
          ? 320
          : 200;
    const hold = typeof segment.holdMs === 'number' && segment.holdMs >= 0 ? segment.holdMs : purposeHold;
    total += spoken + hold + 300;
  }
  return total;
}
