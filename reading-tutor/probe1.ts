import { buildPrompt } from './src/generate.js';
import { SKELETONS } from './src/skeletons.js';
import { assignSlots } from './src/slots.js';
import { allowedWordsForStage, getStage } from './content/stages.js';

const stage = 2;
const sk = SKELETONS[0];
const slots = assignSlots(sk.beats, stage);
const p = buildPrompt({
  stage, cast: { childName: 'Mia', petName: 'Momo' },
  interests: ['dogs','trucks','the moon'],
  storySoFar: '', recentlyMissedWords: [], skeleton: sk, slots,
});
console.log(p);
console.log('\n================ ANALYSIS ================');
const allowed = allowedWordsForStage(stage);
const st = getStage(stage);
const palette = st.generator_palette;
const promptOffered = new Set<string>([
  ...palette.nouns, ...palette.verbs, ...palette.adjectives,
  ...st.sight_words_introduced.map(w=>w.toLowerCase()),
]);
console.log('prompt-offered words:', promptOffered.size);
console.log('validator-allowed words:', allowed.size);
const missing = [...allowed].filter(w=>!promptOffered.has(w));
console.log('legal-but-not-offered count:', missing.length);
const fn=['a','and','i','is','the','to','my','me','we','said','see','on'];
console.log('stage-1 sight words missing from prompt:', fn.filter(w=>!promptOffered.has(w)));
