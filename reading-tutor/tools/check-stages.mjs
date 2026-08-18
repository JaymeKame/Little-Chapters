import fs from 'fs';
const d = JSON.parse(fs.readFileSync('../content/stages.json','utf8'));
let fail = 0;
const ck=(c,m)=>{ if(!c){console.log('  FAIL: '+m); fail++; } };

ck(d.stages.length===10,'10 stages');
ck(d.stages.every((s,i)=>s.id===i+1),'ids are 1..10 in order');

// cumulative sets must be strictly increasing supersets
let prev=new Set();
for(const s of d.stages){
  const cur=new Set(prev);
  s.decodable_words_introduced.forEach(w=>cur.add(w));
  s.sight_words_introduced.forEach(w=>cur.add(w.toLowerCase()));
  ck([...prev].every(w=>cur.has(w)), `stage ${s.id} cumulative is a superset`);
  ck(cur.size>prev.size, `stage ${s.id} adds vocabulary`);
  ck(cur.size===s.counts.cumulative_allowed, `stage ${s.id} count matches (${cur.size} vs ${s.counts.cumulative_allowed})`);
  prev=cur;
}

// no word introduced as decodable twice
const seen=new Map();
for(const s of d.stages) for(const w of s.decodable_words_introduced){
  ck(!seen.has(w), `'${w}' introduced twice (stages ${seen.get(w)} and ${s.id})`);
  seen.set(w,s.id);
}

// palette must be a subset of allowed, and disjoint from blocklists
const block=new Set([...d.content_blocklist,...d.human_nouns]);
prev=new Set();
for(const s of d.stages){
  s.decodable_words_introduced.forEach(w=>prev.add(w));
  s.sight_words_introduced.forEach(w=>prev.add(w.toLowerCase()));
  const p=[...s.generator_palette.nouns,...s.generator_palette.verbs,...s.generator_palette.adjectives];
  for(const w of p){
    ck(prev.has(w), `stage ${s.id} palette word '${w}' not allowed`);
    ck(!block.has(w), `stage ${s.id} palette word '${w}' is blocklisted`);
  }
  ck(s.sentence_length.min>=5 && s.sentence_length.max<=9, `stage ${s.id} sentence length within 5-9`);
  ck(s.sight_words_introduced.length<=12, `stage ${s.id} sight-word load <= 12`);
}

// every sight word has provenance
for(const s of d.stages) for(const w of s.sight_words_introduced)
  ck(d.sight_word_provenance[w], `'${w}' has provenance`);

// every source has a url
for(const s of d.sources) ck(/^https:\/\//.test(s.url), `source ${s.id} has a url`);

console.log(fail? `\n${fail} FAILURES` : 'All invariants hold.');

// Demonstrate: can stage 1 actually make a sentence?
const a1=new Set([...d.stages[0].decodable_words_introduced,...d.stages[0].sight_words_introduced.map(w=>w.toLowerCase())]);
const tries=["Pip sat on my mat","I see a fat pin","my dad is sad and mad","we see the tan fan"];
console.log('\nStage 1 sentence check (Pip = pet proper noun):');
for(const t of tries){
  const bad=t.toLowerCase().split(' ').filter(w=>!a1.has(w)&&w!=='pip');
  console.log(`  "${t}" -> ${bad.length?'REJECT '+bad.join(','):'OK ('+t.split(' ').length+' words)'}`);
}
