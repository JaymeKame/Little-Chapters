import { STAGES } from './content/stages.js';
// Is the generator_palette cumulative?
for (let i=1;i<STAGES.length;i++){
  const prev=STAGES[i-1].generator_palette, cur=STAGES[i].generator_palette;
  const missNouns=prev.nouns.filter(w=>!cur.nouns.includes(w));
  const missVerbs=prev.verbs.filter(w=>!cur.verbs.includes(w));
  const missAdj=prev.adjectives.filter(w=>!cur.adjectives.includes(w));
  console.log(`stage ${STAGES[i].id}: dropped from prev palette -> nouns ${missNouns.length}, verbs ${missVerbs.length}, adj ${missAdj.length}`);
}
console.log('\n--- sight_words_introduced cumulative? ---');
for (let i=1;i<STAGES.length;i++){
  const prev=STAGES[i-1].sight_words_introduced, cur=STAGES[i].sight_words_introduced;
  console.log(`stage ${STAGES[i].id}: carried over from prev sight list: ${prev.filter(w=>cur.includes(w)).length}/${prev.length}`);
}
