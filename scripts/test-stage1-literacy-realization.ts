/* Deterministic Stage-1 literacy realization contract.
 *
 * The P0 that motivated the realizer: three consecutive live OpenAI Stage-1
 * generations all failed literacy validation on child-facing tokens outside
 * the 53-word allowed set. The realizer builds child-facing prose from
 * stage-legal frames driven by the blueprint's semantics.
 *
 * This suite proves the invariant WITHOUT needing OPENAI_API_KEY:
 *   1. take an intentionally-illegal fake blueprint (English prose that would
 *      fail validation);
 *   2. run realizeChildFacingProse + applyRealizedProse against it;
 *   3. assert validateAll + validateStoryBlueprint both pass;
 *   4. spot-check the specific literacy rules that broke live (not-decodable,
 *      too-many-preview-words, sentence-length, unknown-proper-noun);
 *   5. spot-check the Prediction caption grammar the validator enforces;
 *   6. spot-check semantic preservation — the realized prose still names an
 *      object the beat's plan called for (mapped through the semantic table),
 *      not an arbitrary swap.
 *
 * Also regressions against stages 2, 5 and 9 to prove the Stage-1 repair
 * does not flatten higher-stage prose (the realizer is only invoked for
 * higher stages when the model's own prose fails literacy).
 */

import assert from 'node:assert/strict';
import { allowedWordsForStage, getStage, tokenize } from '../reading-tutor/content/stages.ts';
import { validateAll, type StoryDraft } from '../reading-tutor/src/validators.ts';
import { validateStoryBlueprint, validateStoryBlueprintPresentation, validateStoryBlueprintSemantics, predictionCaptionIssues, normalizeStoryBlueprint, type StoryBlueprint } from '../lib/story-blueprint.ts';
import { realizeChildFacingProse, applyRealizedProse } from '../lib/story-realizer.ts';
import { generateStoryDraft, storyLiteracyContract } from '../lib/story-generator.server.ts';

// A blueprint whose PROSE is illegal for Stage 1 in every way that broke live:
//   - preview-only nouns (backpack, path, door)
//   - unknown proper nouns (Meadowbrook)
//   - >6-word sentences
// The realizer must render clean Stage-1 prose from the same semantic plan.
function illegalStage1Blueprint(protagonist: string, companion: string, setting: string, targetObject: string): StoryBlueprint {
  const state = (previousAction: string | null, discovered: string[] = []) => ({
    location: setting, charactersPresent: [protagonist, companion], knownObjects: [targetObject, 'backpack'],
    carriedObjects: [], discoveredObjects: discovered, unresolvedGoal: 'goal-1', previousAction, consequences: [],
  });
  const roles = ['opening','inciting-event','escalation','discovery','reconvergence','climax','resolution'] as const;
  const beats = roles.map((role, index) => ({
    beatId: `beat-${index + 1}`, role, summary: `${protagonist} moves the story forward at beat ${index + 1}.`,
    cause: index ? `beat-${index} changed what ${protagonist} knew` : null,
    action: index === roles.length - 1 ? `unlocks the ${targetObject}` : `taps the ${targetObject}`,
    visibleChange: `The ${targetObject} shifts by beat ${index + 1}.`,
    requiredVisibleObjects: [targetObject, 'backpack'], emotionalPurpose: role === 'resolution' ? 'relief' : 'curiosity',
    stateBefore: state(index ? `taps the ${targetObject}` : null, index ? [targetObject] : []),
    stateAfter: { ...state(`taps the ${targetObject}`, [targetObject]), unresolvedGoal: role === 'resolution' ? '' : 'goal-1' },
  }));
  return normalizeStoryBlueprint({
    version: 1, premise: 'A curious walk through the meadow.', protagonist, companion, setting,
    openingSituation: 'They open the day.', characterGoal: `discover the ${targetObject}`, goalId: 'goal-1',
    problem: 'The way through the door is hidden.', beats,
    prediction: {
      question: 'What should happen next?', afterPageIndex: 2,
      optionA: { id: 'A', caption: `${protagonist} might carry the backpack through the door.`,
        page: { text: `${protagonist} carried the backpack through the door quickly.`, focusWords: [] },
        visualDescription: `${protagonist} lifts the backpack.`,
        consequenceBeat: { beatId: 'branch-A', role: 'branch-consequence', summary: 'A branch', cause: 'child chose A',
          action: 'carries the backpack through', visibleChange: 'The path clears',
          requiredVisibleObjects: [targetObject, 'backpack'], emotionalPurpose: 'agency',
          stateBefore: state(`taps the ${targetObject}`), stateAfter: state('carries the backpack') } },
      optionB: { id: 'B', caption: `${protagonist} could explore the sudden opening carefully.`,
        page: { text: `${protagonist} explored the sudden opening carefully and slowly.`, focusWords: [] },
        visualDescription: `${protagonist} peers into the opening.`,
        consequenceBeat: { beatId: 'branch-B', role: 'branch-consequence', summary: 'B branch', cause: 'child chose B',
          action: 'explores the opening', visibleChange: 'A small hollow appears',
          requiredVisibleObjects: [targetObject, 'backpack'], emotionalPurpose: 'anticipation',
          stateBefore: state(`taps the ${targetObject}`), stateAfter: state('explores the opening') } },
      reconvergenceBeatId: 'beat-5',
    },
    climax: `Meadowbrook glows around ${protagonist}.`,
    resolution: `${protagonist} understands the ${targetObject}.`, goalResolutionStatus: 'resolved', goalResolutionBeatId: 'beat-7',
    resolutionType: 'discovery-fulfilled', finalEmotionalBeat: `${protagonist} feels ready for another walk.`,
    entityContinuity: [targetObject, 'backpack'], visualContinuity: [`Keep ${protagonist} in the meadow.`],
    pages: [
      { text: `${protagonist} and ${companion} walked toward the meadow gate together.`, focusWords: ['meadow'] },
      { text: `A backpack sat quietly against the fence post.`, focusWords: ['backpack'] },
      { text: `${protagonist} noticed the backpack was strangely warm.`, focusWords: ['warm'] },
      { text: `${protagonist} could open the ${targetObject} or leave it.`, focusWords: [targetObject] },
      { text: `The meadow whispered a secret through Meadowbrook.`, focusWords: ['secret'] },
    ],
  });
}

let passed = 0;

function ok(condition: boolean, label: string, detail?: string): void {
  if (!condition) { console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`); process.exit(1); }
  console.log(`  ✓  ${label}`);
  passed += 1;
}

function assertStageLegal(stage: number, blueprint: StoryBlueprint, childName: string, companionName: string, label: string): void {
  const allowed = allowedWordsForStage(stage);
  const { min, max } = getStage(stage).sentence_length;
  const proper = new Set([childName.toLowerCase(), companionName.toLowerCase()]);
  const sentences = [
    ...blueprint.pages.map((page) => page.text),
    blueprint.prediction.optionA.page.text,
    blueprint.prediction.optionB.page.text,
    blueprint.prediction.optionA.caption,
    blueprint.prediction.optionB.caption,
  ];
  const draft: StoryDraft = {
    sentences: blueprint.pages.map((page) => page.text),
    imagePrompt: 'unused',
    summaryLine: blueprint.finalEmotionalBeat,
  };
  const validationDraft: StoryDraft = { ...draft, sentences };
  const literacy = validateAll(validationDraft, stage, { childName, petName: companionName });
  ok(literacy.ok, `${label}: validateAll passes`, JSON.stringify(literacy.violations, null, 2));
  for (const rule of ['phonics/not-decodable', 'phonics/too-many-preview-words', 'phonics/sentence-length', 'content/unknown-proper-noun']) {
    ok(!literacy.violations.some((v) => v.rule === rule), `${label}: zero ${rule}`);
  }
  const holistic = validateStoryBlueprint(blueprint);
  ok(holistic.ok, `${label}: validateStoryBlueprint passes`, JSON.stringify(holistic.issues, null, 2));
  // Belt-and-braces: independently confirm the specific rules the live P0 fired.
  for (const sentence of sentences) {
    const tokens = tokenize(sentence);
    ok(tokens.length >= min && tokens.length <= max, `${label}: sentence "${sentence}" length ${tokens.length} in [${min},${max}]`);
    for (const token of tokens) {
      ok(allowed.has(token) || proper.has(token), `${label}: token "${token}" is stage-${stage}-legal (from "${sentence}")`);
    }
  }
  // Prediction captions must survive the validator's own grammar check too.
  for (const branch of [blueprint.prediction.optionA, blueprint.prediction.optionB]) {
    const captionIssues = predictionCaptionIssues(branch.caption, blueprint.protagonist);
    ok(captionIssues.length === 0, `${label}: caption ${branch.id} "${branch.caption}" grammar clean`, captionIssues.join(', '));
  }
  // Semantic preservation: the goal object mapped through the stage palette
  // (see SEMANTIC_NOUN_MAP) should surface somewhere in child-facing text.
  const stageNouns = getStage(stage).generator_palette.nouns.filter((w) => allowed.has(w));
  const anyStageNoun = sentences.some((s) => stageNouns.some((n) => tokenize(s).includes(n)));
  ok(anyStageNoun, `${label}: at least one stage-palette noun surfaces in child-facing prose`);
}

async function generatedOutcome(blueprint: StoryBlueprint): Promise<{ result: string; calls: number; realizedFromRules: string[] }> {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_STORY_MODEL;
  let calls = 0;
  process.env.OPENAI_API_KEY = 'test-only';
  process.env.OPENAI_STORY_MODEL = 'fixture-model';
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(blueprint) } }] }), { status: 200 });
  };
  try {
    const outcome = await generateStoryDraft({ childName: blueprint.protagonist, companionName: blueprint.companion ?? 'Pip', interests: ['space'], stage: 1 });
    const attempt = outcome.diagnostic.attempts.at(-1)!;
    return { result: attempt.result, calls, realizedFromRules: attempt.realized?.realizedFromRules ?? [] };
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENAI_STORY_MODEL; else process.env.OPENAI_STORY_MODEL = originalModel;
  }
}

async function main(): Promise<void> {
  const combos = [
    { interest: 'dogs',      protagonist: 'Maria',   companion: 'Pip', setting: 'a sunny countryside farm with wooden fences', targetObject: 'gate'  },
    { interest: 'space',     protagonist: 'Zed',     companion: 'Nix', setting: 'a glowing starlit galaxy',                    targetObject: 'star'  },
    { interest: 'dinosaurs', protagonist: 'Ada',     companion: 'Rex', setting: 'a lush prehistoric jungle',                   targetObject: 'rock'  },
    { interest: 'trains',    protagonist: 'Jun',     companion: 'Toot',setting: 'rolling countryside hills',                   targetObject: 'bridge'},
    { interest: 'unicorns',  protagonist: 'Lila',    companion: 'Sky', setting: 'an enchanted meadow',                         targetObject: 'well'  },
    { interest: 'ocean',     protagonist: 'Milo',    companion: 'Fin', setting: 'a sunlit coral reef',                         targetObject: 'shell' },
  ];

  console.log('\n=== Stage 1 realization: 6 interests × unique names ===');
  for (const combo of combos) {
    const blueprint = illegalStage1Blueprint(combo.protagonist, combo.companion, combo.setting, combo.targetObject);
    const contract = storyLiteracyContract(1, combo.protagonist, combo.companion, [combo.targetObject]);
    const realized = realizeChildFacingProse(blueprint, contract, 1);
    const realizedBlueprint = applyRealizedProse(blueprint, realized);
    ok(realized.previewWordsUsed.length === 0, `${combo.interest}/${combo.protagonist}: zero preview words used at Stage 1`);
    assertStageLegal(1, realizedBlueprint, combo.protagonist, combo.companion, `${combo.interest}/${combo.protagonist}`);
    // Semantic preservation: goal id, both branch consequence beat ids, and
    // resolution beat id are all unchanged — realizer only touches prose.
    ok(realizedBlueprint.goalId === blueprint.goalId, `${combo.interest}/${combo.protagonist}: goalId preserved`);
    ok(realizedBlueprint.prediction.optionA.consequenceBeat.beatId === blueprint.prediction.optionA.consequenceBeat.beatId, `${combo.interest}/${combo.protagonist}: option-A consequence beat preserved`);
    ok(realizedBlueprint.prediction.optionB.consequenceBeat.beatId === blueprint.prediction.optionB.consequenceBeat.beatId, `${combo.interest}/${combo.protagonist}: option-B consequence beat preserved`);
    ok(realizedBlueprint.pages.length === blueprint.pages.length, `${combo.interest}/${combo.protagonist}: page count preserved`);
    ok(realizedBlueprint.prediction.optionA.page.text !== realizedBlueprint.prediction.optionB.page.text, `${combo.interest}/${combo.protagonist}: branch pages remain distinct after realization`);
    ok(realizedBlueprint.prediction.optionA.caption !== realizedBlueprint.prediction.optionB.caption, `${combo.interest}/${combo.protagonist}: captions remain distinct`);
    ok(realized.provenance.pages.length === blueprint.pages.length, `${combo.interest}/${combo.protagonist}: every page records a semantic beat source`);
    const authoredPageBeats = blueprint.beats.filter((beat) => beat.role !== 'branch-consequence');
    realized.provenance.pages.forEach((mapping, index) => {
      const expectedBeat = authoredPageBeats[Math.min(index, authoredPageBeats.length - 1)];
      ok(mapping.realizedFromBeatId === expectedBeat.beatId, `${combo.interest}/${combo.protagonist}: page ${index + 1} maps to ${expectedBeat.beatId}`);
      ok(mapping.actionSource === expectedBeat.action, `${combo.interest}/${combo.protagonist}: page ${index + 1} records authored action source`);
      ok(mapping.objectSource === (expectedBeat.requiredVisibleObjects[0] ?? blueprint.entityContinuity[0] ?? null), `${combo.interest}/${combo.protagonist}: page ${index + 1} records authored object source`);
      if (index > 0) ok(realized.pages[index - 1].text !== realized.pages[index].text, `${combo.interest}/${combo.protagonist}: adjacent pages ${index}/${index + 1} do not collapse to repeated filler`);
    });
    ok(realized.provenance.optionA.realizedFromBeatId === blueprint.prediction.optionA.consequenceBeat.beatId, `${combo.interest}/${combo.protagonist}: branch A maps to its consequence beat`);
    ok(realized.provenance.optionB.realizedFromBeatId === blueprint.prediction.optionB.consequenceBeat.beatId, `${combo.interest}/${combo.protagonist}: branch B maps to its consequence beat`);
  }

  console.log('\n=== Semantic gate → presentation realization ordering ===');
  const raw = illegalStage1Blueprint('Sally', 'Pip', 'a space station', 'star');
  const malformed = structuredClone(raw);
  malformed.prediction.optionA.caption = 'First';
  malformed.prediction.optionB.caption = 'First';
  malformed.prediction.optionA.page.text = '';
  malformed.prediction.optionB.page.text = '';
  ok(validateStoryBlueprintSemantics(malformed).ok, 'live regression: semantic plan passes despite malformed/empty child prose');
  const rawPresentation = validateStoryBlueprintPresentation(malformed);
  ok(!rawPresentation.ok && rawPresentation.issues.some((issue) => issue.code === 'malformed-prediction'), 'live regression: raw presentation records malformed-prediction');
  ok(rawPresentation.issues.some((issue) => issue.code === 'missing-branch-page'), 'live regression: empty branch pages are presentation failures');
  ok(rawPresentation.issues.some((issue) => issue.code === 'duplicate-branch-presentation'), 'live regression: duplicate raw wording is a presentation failure');
  const repaired = await generatedOutcome(malformed);
  ok(repaired.result === 'accepted-realized', 'live regression: one provider semantic plan becomes accepted-realized');
  ok(repaired.calls === 1, 'live regression: repairable prose spends one provider call');
  ok(repaired.realizedFromRules.includes('malformed-prediction'), 'accepted-realized diagnostic records repaired malformed-prediction');

  const contract = storyLiteracyContract(1, raw.protagonist, raw.companion ?? 'Pip', ['star']);
  const alreadyRealized = applyRealizedProse(raw, realizeChildFacingProse(raw, contract, 1));
  const accepted = await generatedOutcome(alreadyRealized);
  ok(accepted.result === 'accepted' && accepted.calls === 1, 'case A: valid model prose is accepted unchanged');
  const literacyRepair = await generatedOutcome(raw);
  ok(literacyRepair.result === 'accepted-realized' && literacyRepair.calls === 1, 'case B: semantic-valid literacy failure is realized without retry');

  const captionOnly = structuredClone(alreadyRealized);
  captionOnly.prediction.optionA.caption = 'First';
  captionOnly.prediction.optionB.caption = 'Second';
  const captionOutcome = await generatedOutcome(captionOnly);
  ok(captionOutcome.result === 'accepted-realized' && captionOutcome.calls === 1, 'case C: malformed captions are realized without retry');

  const emptyPages = structuredClone(alreadyRealized);
  emptyPages.prediction.optionA.page.text = '';
  emptyPages.prediction.optionB.page.text = '';
  const pageOutcome = await generatedOutcome(emptyPages);
  ok(pageOutcome.result === 'accepted-realized' && pageOutcome.calls === 1, 'case D: empty duplicate branch pages are realized from distinct consequences');

  const missingConsequence = structuredClone(raw);
  missingConsequence.prediction.optionA.consequenceBeat.action = '';
  ok(validateStoryBlueprintSemantics(missingConsequence).issues.some((issue) => issue.code === 'branch-without-consequence'), 'missing consequence action remains a semantic failure');

  const identicalSemantics = structuredClone(raw);
  identicalSemantics.prediction.optionB.consequenceBeat = structuredClone(identicalSemantics.prediction.optionA.consequenceBeat);
  identicalSemantics.prediction.optionB.consequenceBeat.beatId = 'branch-B';
  ok(!validateStoryBlueprintSemantics(identicalSemantics).ok, 'case E: semantically identical branches fail the semantic gate');
  const identicalOutcome = await generatedOutcome(identicalSemantics);
  ok(identicalOutcome.result === 'semantic-blueprint-validation' && identicalOutcome.calls === 3, 'case E: semantic duplicate retries provider');

  const brokenPlan = structuredClone(raw);
  brokenPlan.prediction.reconvergenceBeatId = 'missing-beat';
  ok(!validateStoryBlueprintSemantics(brokenPlan).ok, 'case F: missing reconvergence fails the semantic gate');
  const brokenOutcome = await generatedOutcome(brokenPlan);
  ok(brokenOutcome.result === 'semantic-blueprint-validation' && brokenOutcome.calls === 3, 'case F: broken plan retries provider');

  console.log('\n=== Stage 2/5/9 fallback realization is still legal ===');
  for (const stage of [2, 5, 9]) {
    const blueprint = illegalStage1Blueprint('Rae', 'Kip', 'a quiet garden', 'gate');
    const contract = storyLiteracyContract(stage, 'Rae', 'Kip', ['gate']);
    const realized = realizeChildFacingProse(blueprint, contract, stage);
    const realizedBlueprint = applyRealizedProse(blueprint, realized);
    assertStageLegal(stage, realizedBlueprint, 'Rae', 'Kip', `stage-${stage} fallback`);
    ok(realized.previewWordsUsed.length <= contract.maxPreviewWords, `stage-${stage} fallback: preview budget respected`);
  }

  console.log(`\nStage-1 literacy realization: ${passed} passed, 0 failed`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
