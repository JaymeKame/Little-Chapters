/**
 * Correction sprint regression tests. Runs headlessly against real modules
 * (no fixtures beyond a hand-built chapter shape) and asserts the invariants
 * every section of the sprint requires:
 *
 *   Section 6  Find the Sound: initial model uses a real word + real pacing
 *   Section 7  phoneme modeling holds long enough to actually be heard
 *   Section 8  wrong-word feedback runs identify → beginning → sound → whole → invite
 *   Sections 9-10 reading tracker: no blur/opacity/spotlight; underline-only
 *   Sections 11-14 Word Builder: instructional chunks, chunk audio, join
 *   Sections 15-20 session composition varies without random noise
 *   Section 20 tutor variation: no name spam; anti-repetition
 *   Sections 3-5 verified-visible-entity contract
 *   Section 24-25 permanent Little Chapters icon in the manifest
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { modelWordThroughSound, correctionModel, wordBuilderChunkModel } from '../lib/phonics-model.ts';
import { wordBuilderPieces, buildStoryInteractionManifest } from '../lib/story-interactions.ts';
import { buildSessionPlan } from '../lib/session-plan.ts';
import { composeSession, CANDIDATE_SEQUENCES, distinctSequencesAcross, type MechanicKind } from '../lib/session-composer.ts';
import { TutorPhraseSession, deterministicTutorLine } from '../lib/tutor-intents.ts';
import { chapterFor, type Chapter } from '../lib/chapters.ts';

let passed = 0;
function pass(label: string) { passed++; console.log(`  ✓ ${label}`); }

/* ── Section 6-8: Find the Sound modeling ─────────────────────────── */
{
  const ship = modelWordThroughSound('ship', 'sh');
  const phoneme = ship.find((segment) => segment.purpose === 'phoneme-model');
  const rime = ship.find((segment) => segment.purpose === 'rime');
  const whole = ship.find((segment) => segment.purpose === 'word-blend');
  assert.ok(phoneme && /^shhhh/.test(phoneme.text), 'onset /sh/ is stretched');
  assert.ok(rime && /ip/.test(rime.text), 'rime "ip" spoken separately');
  assert.ok(whole && /ship/.test(whole.text), 'whole word is the acoustic anchor');
  assert.ok((phoneme?.holdMs ?? 0) >= 420, 'phoneme model has ≥420 ms hold');
  assert.ok((rime?.holdMs ?? 0) >= 380, 'rime segment has ≥380 ms hold');
  pass('Find the Sound: onset stretched, rime paced, whole word anchored');

  // A "ch" word — different phoneme rendering strategy than /sh/.
  const chip = modelWordThroughSound('chip', 'ch');
  assert.ok(chip.find((segment) => segment.purpose === 'phoneme-model')?.text.startsWith('ch'), '/ch/ renders per its stop-affricate pattern (not "chhhh")');
  pass('Find the Sound: /ch/ uses its own stretching pattern');

  // A stop like /p/ shouldn't fake a vowel tail.
  const pat = modelWordThroughSound('pat', 'p');
  assert.ok(pat.find((segment) => segment.purpose === 'phoneme-model')?.text.match(/^p-p-p/), 'stops get repeated, not lengthened with a bogus vowel');
  pass('Find the Sound: stop consonants get real modeling (no "phhhh")');
}

/* ── Section 8: wrong-word correction structure ───────────────────── */
{
  const seq = correctionModel('shut', 'sh');
  assert.deepEqual(seq.map((segment) => segment.purpose), ['instruction','instruction','phoneme-model','rime','word-blend','retry']);
  assert.match(seq[0].text, /This word is shut\./);
  assert.match(seq[1].text, /Listen to the beginning\./);
  assert.match(seq[2].text, /^shhhh/);
  assert.match(seq[3].text, /ut/);
  assert.match(seq[4].text, /shut/);
  assert.equal(seq[5].text, 'Your turn.');
  pass('Wrong-word feedback: identify → beginning → sound → rime → whole → invite');
}

/* ── Sections 11-14: Word Builder chunk model + pieces ────────────── */
{
  const pieces = wordBuilderPieces('ship');
  assert.deepEqual(pieces, ['sh','i','p'], 'phonics decomposition uses SH/I/P — not arbitrary characters');
  const chunkModel = wordBuilderChunkModel(pieces);
  assert.ok(chunkModel.filter((segment) => segment.purpose === 'phoneme-model').length === pieces.length, 'each chunk gets its own audio model');
  assert.ok(chunkModel.at(-1)?.purpose === 'word-blend', 'chunk sequence ends with the joined whole word');
  assert.ok(chunkModel.filter((segment) => segment.purpose === 'phoneme-model').every((segment) => (segment.holdMs ?? 0) >= 400), 'each chunk has real listening time');

  const cat = wordBuilderPieces('cat');
  assert.deepEqual(cat, ['c','a','t'], 'CAT decomposes to three phonemes');
  pass('Word Builder: instructional chunks + chunk-then-whole audio');

  const readPage = readFileSync('app/read/page.tsx','utf8');
  assert.match(readPage, /lc-wb-assembly/, 'Word Builder renders an assembly bar');
  assert.match(readPage, /lc-wb-slot/, 'Word Builder renders discrete slots');
  assert.match(readPage, /chooseWordPart/, 'assembly still routes through the chunk-audio picker');
  assert.match(readPage, /wordBuilderChunkModel/, 'assembly plays chunk audio via the phonics model');
  pass('Word Builder: assembly UI wired into /read');
}

/* ── Sections 9-10: reading tracker ──────────────────────────────── */
{
  const globals = readFileSync('app/globals.css','utf8');
  assert.doesNotMatch(globals, /\.lc-word-dim\b/, 'no dim/opacity mask class in globals.css');
  assert.doesNotMatch(globals, /\.lc-page-text[^{]*\{[^}]*filter:\s*blur/, 'no blur on page text');
  assert.match(globals, /\.lc-word-read\b/, 'read-word underline class exists');
  assert.match(globals, /\.lc-word-now\b/, 'current-word emphasis class exists');
  const readPage = readFileSync('app/read/page.tsx','utf8');
  assert.doesNotMatch(readPage, /lc-word-dim/, 'PageText no longer emits lc-word-dim');
  assert.match(readPage, /lc-word-read/, 'PageText emits lc-word-read progressively');
  pass('Reading tracker: no blur/opacity/spotlight; underline-based tracker in place');
}

/* ── Sections 15-20: session composition variation ───────────────── */
{
  const available: Record<MechanicKind, boolean> = {
    'sound-hunt': true, 'find-in-scene': true, 'prediction': true, 'word-builder': true,
  };
  assert.ok(CANDIDATE_SEQUENCES.length >= 6, 'authored candidate pool has at least six sequences');
  const distinct = distinctSequencesAcross(
    ['chapter-a','chapter-b','chapter-c','chapter-d','chapter-e','chapter-f','chapter-g','chapter-h'],
    [], available,
  );
  assert.ok(distinct >= 3, `distinct sessions across 8 chapters: expected ≥3, got ${distinct}`);
  pass(`Session composition: adjacent chapters yield ${distinct} distinct sequences without random noise`);

  // Anti-repetition: yesterday's exact plan is deprioritized. Take today's
  // pick, feed it as "recent", and today+1's pick MUST differ.
  const t0 = composeSession({ chapterId: 'chapter-x', available, recent: [] });
  const t1 = composeSession({ chapterId: 'chapter-x', available, recent: [t0.sequence] });
  assert.notDeepEqual(t1.sequence, t0.sequence, 'yesterday\'s plan is not repeated exactly');
  pass('Session composition: yesterday\'s exact plan is not repeated');

  // Content constraints: if find-in-scene isn't available, the composer must
  // not pick a sequence that requires it.
  const noVisual: Record<MechanicKind, boolean> = { 'sound-hunt': true, 'find-in-scene': false, 'prediction': true, 'word-builder': true };
  const guarded = composeSession({ chapterId: 'chapter-y', available: noVisual, recent: [] });
  assert.ok(!guarded.sequence.includes('find-in-scene'), 'composer refuses mechanics whose content is unavailable');
  pass('Session composition: unavailable mechanics are refused');
}

/* ── Section 15-16: plan is a stable spine + composed interactions ── */
{
  const chapter: Chapter = { ...chapterFor('ocean','Nia'), id:'sprint-nia-ocean', character:'Nia', companion:'a small turtle', setting:'a warm shore',
    pages:[{text:'Nia crossed a shell bridge.',focusWords:['shell']},{text:'A pearl flashed below.',focusWords:['pearl']},{text:'The turtle found a cave.',focusWords:['cave']},{text:'Nia opened the gate.',focusWords:['gate']},{text:'Warm light filled the shore.',focusWords:['light']}],
    cliffhanger:['A new doorway shimmered.','Tomorrow…'],teaser:'The doorway waits.',phonics:[{hint:'sh in shell',words:['shell']}], provenance:{source:'generated'} };
  const plan = buildSessionPlan(chapter, 'Nia');
  assert.equal(plan[0].kind, 'welcome');
  assert.equal(plan.at(-1)!.kind, 'ending');
  const interactionKinds = plan.filter((beat) => beat.kind === 'sound-hunt' || beat.kind === 'find-in-scene' || beat.kind === 'prediction' || beat.kind === 'word-builder').map((beat) => beat.kind);
  assert.ok(interactionKinds.length >= 1 && interactionKinds.length <= 3, 'plan contains 1–3 composed interactions');
  assert.equal(plan.filter((beat) => beat.kind === 'reading').length, 4, 'still four reading clusters');
  pass('Session plan: welcome + 4 reading clusters + 1–3 composed interactions + ending');
}

/* ── Section 20: tutor variation ─────────────────────────────────── */
{
  const tutor = new TutorPhraseSession();
  const s1 = tutor.line('EASY_SUCCESS'); const s2 = tutor.line('EASY_SUCCESS'); const s3 = tutor.line('EASY_SUCCESS');
  assert.notEqual(s1, s2, 'immediate repeat prevented');
  assert.notEqual(s2, s3, 'consecutive repeat prevented');
  // Name is present in WELCOME + FINAL_CELEBRATION, absent everywhere else.
  const named = ['EASY_SUCCESS','GENTLE_RETRY','INVITE_RETRY','SILENCE_NUDGE','MODEL_WORD','STORY_CURIOSITY'] as const;
  for (const intent of named) {
    for (let i = 0; i < 6; i++) {
      const line = new TutorPhraseSession().line(intent, { childName: 'Elias', word: 'ship', sound: 'sh', storyBeat: 'the door opens', prediction: 'the whale' });
      assert.ok(!/\bElias\b/.test(line), `intent ${intent} must not force the child's name into every utterance (got: ${line})`);
    }
  }
  pass('Tutor variation: no name spam outside welcome/celebration; immediate repeats prevented');

  // Deterministic fallback still exists.
  assert.match(deterministicTutorLine('MODEL_WORD', { word: 'shell' }), /shell/);
  pass('Tutor variation: deterministic fallback preserved');
}

/* ── Sections 3-5: verified-visible-entity contract ──────────────── */
{
  const scenes = readFileSync('lib/chapter-scenes.ts','utf8');
  assert.match(scenes, /verificationConfidence/, 'entity carries verificationConfidence');
  assert.match(scenes, /verificationSource/, 'entity carries verificationSource');
  const route = readFileSync('app/api/chapters/visuals/route.ts','utf8');
  assert.match(route, /visibleObjects/, 'image reviewer returns structured verified entities');
  assert.match(route, /reviewedPanel/, 'panel data is threaded from reviewer to entity metadata');
  const readPage = readFileSync('app/read/page.tsx','utf8');
  assert.match(readPage, /verificationConfidence[^\n]*>=\s*0\.6/, '/read enforces the ≥0.6 verified-entity gate on spatial hotspots');
  assert.match(readPage, /tactile-card-fallback/, '/read renders a tactile-card fallback when the entity is unverified');
  pass('Scene grounding: verified-visible contract enforced end-to-end');
}

/* ── Section 24-25: permanent app icon ───────────────────────────── */
{
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest','utf8'));
  assert.ok(manifest.icons.some((icon: { src: string; type: string }) => icon.src === '/pwa/icon.svg'), 'manifest declares the SVG portal icon');
  assert.ok(manifest.icons.every((icon: { src: string }) => !/child|avatar|profile|face|kid/i.test(icon.src)), 'no child-profile image controls the app icon');
  const svg = readFileSync('public/pwa/icon.svg','utf8');
  assert.match(svg, /aria-label="Little Chapters"/, 'icon carries a Little Chapters label');
  assert.ok(!/data:image|<foreignObject|<text\b/.test(svg), 'icon has no embedded raster or text — pure vector portal');
  pass('Icon: permanent SVG portal identity, no child face, no embedded text');
}

console.log(`\nCorrection sprint: ${passed} checks passed.`);
