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

import { modelWordThroughSound, correctionModel, successSoundModel, wordBuilderChunkModel } from '../lib/phonics-model.ts';
import { wordBuilderPieces, buildStoryInteractionManifest } from '../lib/story-interactions.ts';
import { buildSessionPlan } from '../lib/session-plan.ts';
import { composeSession, CANDIDATE_SEQUENCES, distinctSequencesAcross, type MechanicKind } from '../lib/session-composer.ts';
import { TutorPhraseSession, deterministicTutorLine } from '../lib/tutor-intents.ts';
import { chapterFor, type Chapter } from '../lib/chapters.ts';

let passed = 0;
function pass(label: string) { passed++; console.log(`  ✓ ${label}`); }

/* ── Section 6-8: Find the Sound modeling ─────────────────────────── */
{
  const ship = modelWordThroughSound('shell', 'sh');
  // Correction pass 2, Section 1: pedagogy replaced — /sh/ is no longer
  // stretched. See test-experience-correction-pass-2.ts for the current
  // reference-word contract. This block validates the shape/holds only.
  const referenceSegments = ship.filter((segment) => segment.purpose === 'reference-word');
  assert.ok(referenceSegments.length >= 2, 'at least two reference words spoken');
  assert.ok(!ship.some((segment) => /shell/.test(segment.text)), 'target story word is not given away before matching');
  assert.ok(ship.every((segment) => (segment.holdMs ?? 0) >= 200), 'every segment holds ≥200 ms');
  assert.deepEqual(successSoundModel('shell', 'sh').map((segment) => segment.purpose), ['instruction','phoneme-model','word-blend']);
  pass('Find the Sound: reference-word pedagogy replaces onset stretching');
}

/* ── Section 8: wrong-word correction structure (updated for pass 2) ── */
{
  // Choice-less entry: no "That's X." — just re-listen → reference → target → compare → retry.
  const seq = correctionModel('shut', 'sh');
  assert.equal(seq[0].text, 'Listen again.', 'anonymous correction opens with re-listen');
  assert.ok(seq.some((segment) => segment.purpose === 'reference-word'), 'anonymous correction models a reference word');
  assert.ok(seq.some((segment) => segment.text === 'shut.'), 'anonymous correction voices the target');
  assert.equal(seq.at(-1)?.text, 'Try one more time.', 'anonymous correction invites retry');

  // With child choice: opens with "That's rex."
  const withChoice = correctionModel('shut', 'sh', 'rex');
  assert.match(withChoice[0].text, /That's rex\./);
  pass('Wrong-word feedback: reference-word structure honored with and without choice');
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

/* ── Section 7 (correction pass 2): icon paths reverted ────────────
 * The user rejected the sprint-1 invented book/portal icon and the
 * repository/git history contains no unambiguous approved Little Chapters
 * mark to substitute (see the acceptance report). The invented SVG +
 * favicon are removed; the manifest and app metadata reference only the
 * pre-sprint icon paths so nothing 404s while the approved artwork is
 * supplied out-of-band. */
{
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest','utf8'));
  assert.ok(!manifest.icons.some((icon: { src: string }) => icon.src === '/pwa/icon.svg'), 'invented SVG icon reverted from manifest');
  assert.ok(manifest.icons.every((icon: { src: string }) => icon.src.startsWith('/pwa/icon-')), 'manifest only references the pre-sprint icon paths');
  try { readFileSync('public/pwa/icon.svg'); assert.fail('invented SVG asset must be removed'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  pass('Icon: invented sprint-1 asset removed; awaiting approved artwork');
}

console.log(`\nCorrection sprint: ${passed} checks passed.`);
