import type { ChapterPage } from './chapters';

export interface StoryState {
  location: string;
  charactersPresent: string[];
  knownObjects: string[];
  carriedObjects: string[];
  discoveredObjects: string[];
  unresolvedGoal: string;
  previousAction: string | null;
  consequences: string[];
}

export interface StoryBlueprintBeat {
  beatId: string;
  role: 'opening' | 'inciting-event' | 'escalation' | 'discovery' | 'branch-consequence' | 'reconvergence' | 'climax' | 'resolution';
  summary: string;
  cause: string | null;
  action: string;
  visibleChange: string;
  requiredVisibleObjects: string[];
  emotionalPurpose: string;
  stateBefore: StoryState;
  stateAfter: StoryState;
}

export interface PredictionBranch {
  id: 'A' | 'B';
  caption: string;
  consequenceBeat: StoryBlueprintBeat;
  page: ChapterPage;
  visualDescription: string;
}

export interface StoryBlueprint {
  version: 1;
  premise: string;
  protagonist: string;
  companion: string | null;
  setting: string;
  openingSituation: string;
  characterGoal: string;
  problem: string;
  beats: StoryBlueprintBeat[];
  prediction: {
    question: string;
    afterPageIndex: number;
    optionA: PredictionBranch;
    optionB: PredictionBranch;
    reconvergenceBeatId: string;
  };
  climax: string;
  resolution: string;
  finalEmotionalBeat: string;
  entityContinuity: string[];
  visualContinuity: string[];
  pages: ChapterPage[];
}

export interface BlueprintIssue { code: string; detail: string }
export interface BlueprintValidation { ok: boolean; issues: BlueprintIssue[] }

const BAD_PREDICTION = [
  /\b(something happens|the next thing|what happens next)\b/i,
  /\b(the|a|an|to|from|with|behind|under|over|sat)\.?$/i,
  /\bfollows\s+the\s+(behind|sat)\b/i,
];
const FINITE_VERBS = new Set(['appears','asks','begins','checks','climbs','comes','crosses','finds','follows','glows','hears','helps','leads','looks','moves','opens','pulls','pushes','runs','sees','shows','splashes','steps','takes','turns','waits','walks']);

export function predictionCaptionIssues(caption: string, protagonist?: string): string[] {
  const clean = caption.trim();
  const words = clean.replace(/[.!?]+$/, '').split(/\s+/).filter(Boolean);
  const issues: string[] = [];
  if (words.length < 4) issues.push('too-short');
  if (!/^[A-Z][^!?]*[.!]$/.test(clean)) issues.push('not-complete-sentence');
  if (BAD_PREDICTION.some((pattern) => pattern.test(clean))) issues.push('fragment-or-placeholder');
  const subject = protagonist?.toLowerCase();
  const candidateWords = words.slice(subject && words[0]?.toLowerCase() === subject ? 1 : 1).map((word) => word.toLowerCase().replace(/[^a-z]/g, ''));
  if (!candidateWords.some((word) => FINITE_VERBS.has(word))) issues.push('missing-finite-action');
  if (new Set(words.map((word) => word.toLowerCase())).size < Math.max(3, words.length - 1)) issues.push('template-repetition');
  return [...new Set(issues)];
}

function sameSetOrSubset(known: string[], next: string[]): string[] {
  const before = new Set(known.map((word) => word.toLowerCase()));
  return next.filter((word) => !before.has(word.toLowerCase()));
}

export function validateStoryBlueprint(blueprint: StoryBlueprint): BlueprintValidation {
  const issues: BlueprintIssue[] = [];
  const add = (code: string, detail: string) => issues.push({ code, detail });
  if (!blueprint.premise || !blueprint.characterGoal || !blueprint.problem) add('missing-foundation', 'Premise, goal, and problem are required.');
  if (blueprint.pages.length < 5) add('page-count', 'A complete chapter needs at least five authored pages.');
  if (blueprint.beats.length < 6) add('beat-count', 'Opening through resolution must be planned before prose.');
  for (let index = 0; index < blueprint.beats.length; index += 1) {
    const beat = blueprint.beats[index];
    if (index > 0 && !beat.cause) add('missing-cause', `${beat.beatId} does not state what caused it.`);
    if (!beat.action || !beat.visibleChange) add('incomplete-beat', `${beat.beatId} lacks an action or visible change.`);
    if (beat.stateBefore.unresolvedGoal !== blueprint.beats[Math.max(0, index - 1)].stateAfter.unresolvedGoal && beat.role !== 'resolution') {
      add('goal-discontinuity', `${beat.beatId} changes the unresolved goal without resolution.`);
    }
    const allowedBefore = [...beat.stateBefore.knownObjects, ...beat.stateBefore.discoveredObjects, ...beat.stateBefore.carriedObjects];
    const unexplained = sameSetOrSubset(allowedBefore, beat.requiredVisibleObjects).filter((object) => !beat.stateAfter.discoveredObjects.includes(object));
    if (index > 0 && unexplained.length) add('unexplained-entity', `${beat.beatId} introduces ${unexplained.join(', ')} without discovery.`);
  }
  const a = blueprint.prediction.optionA;
  const b = blueprint.prediction.optionB;
  for (const branch of [a, b]) {
    for (const problem of predictionCaptionIssues(branch.caption, blueprint.protagonist)) add('malformed-prediction', `${branch.id}: ${problem}`);
    if (!branch.consequenceBeat.cause || !branch.page.text) add('branch-without-consequence', `${branch.id} has no authored consequence.`);
  }
  if (a.caption.toLowerCase() === b.caption.toLowerCase() || a.page.text.toLowerCase() === b.page.text.toLowerCase()) add('duplicate-branches', 'Prediction branches must differ in choice and consequence.');
  if (!blueprint.beats.some((beat) => beat.beatId === blueprint.prediction.reconvergenceBeatId)) add('missing-reconvergence', 'Prediction references no authored reconvergence beat.');
  if (!blueprint.resolution.toLowerCase().includes(blueprint.characterGoal.split(/\s+/).at(-1)?.toLowerCase() ?? '')) add('unresolved-ending', 'Resolution must explicitly close the original goal.');
  return { ok: issues.length === 0, issues };
}

export function selectedBranch(blueprint: StoryBlueprint, choice: string | null): PredictionBranch | null {
  if (!choice) return null;
  return [blueprint.prediction.optionA, blueprint.prediction.optionB].find((branch) => branch.id === choice || branch.caption === choice) ?? null;
}

export function materializeStoryPages(blueprint: StoryBlueprint, choice: string | null): ChapterPage[] {
  const branch = selectedBranch(blueprint, choice);
  if (!branch) return blueprint.pages;
  const pages = [...blueprint.pages];
  pages[blueprint.prediction.afterPageIndex + 1] = branch.page;
  return pages;
}

export function storyBeatVisualPrompt(blueprint: StoryBlueprint, beat: StoryBlueprintBeat): string {
  const state = beat.stateAfter;
  return [
    `STORY BEAT: ${beat.summary}`,
    `SETTING: ${state.location}.`,
    `CHARACTERS: ${state.charactersPresent.join(', ')}.`,
    `VISIBLE ACTION: ${beat.action}.`,
    `REQUIRED VISIBLE OBJECTS: ${beat.requiredVisibleObjects.join(', ') || 'none'}.`,
    `VISIBLE CHANGE SINCE PRIOR BEAT: ${beat.visibleChange}.`,
    `EMOTIONAL PURPOSE: ${beat.emotionalPurpose}.`,
    `CONTINUITY: carried objects ${state.carriedObjects.join(', ') || 'none'}; preserve ${blueprint.visualContinuity.join('; ')}.`,
  ].join(' ');
}

export function blueprintGenerationPrompt(input: { childName: string; companionName: string; interests: string[]; childContext?: string; stage: number; targetWords: string[]; storySoFar?: string }): string {
  const context = input.childContext?.trim().slice(0, 1200);
  return `Create one original Little Chapters story as STRICT JSON. Plan the complete causal chapter before prose. Return exactly this shape (no markdown):
{"version":1,"premise":"","protagonist":"","companion":"","setting":"","openingSituation":"","characterGoal":"","problem":"","beats":[{"beatId":"beat-1","role":"opening|inciting-event|escalation|discovery|reconvergence|climax|resolution","summary":"","cause":null,"action":"","visibleChange":"","requiredVisibleObjects":[],"emotionalPurpose":"","stateBefore":{"location":"","charactersPresent":[],"knownObjects":[],"carriedObjects":[],"discoveredObjects":[],"unresolvedGoal":"","previousAction":null,"consequences":[]},"stateAfter":{"location":"","charactersPresent":[],"knownObjects":[],"carriedObjects":[],"discoveredObjects":[],"unresolvedGoal":"","previousAction":"","consequences":[]}}],"prediction":{"question":"","afterPageIndex":2,"optionA":{"id":"A","caption":"complete proposition.","consequenceBeat":{"beatId":"branch-A","role":"branch-consequence","summary":"","cause":"child chose A","action":"","visibleChange":"","requiredVisibleObjects":[],"emotionalPurpose":"","stateBefore":{"location":"","charactersPresent":[],"knownObjects":[],"carriedObjects":[],"discoveredObjects":[],"unresolvedGoal":"","previousAction":"","consequences":[]},"stateAfter":{"location":"","charactersPresent":[],"knownObjects":[],"carriedObjects":[],"discoveredObjects":[],"unresolvedGoal":"","previousAction":"","consequences":[]}},"page":{"text":"","focusWords":[]},"visualDescription":""},"optionB":{"id":"B","caption":"different complete proposition.","consequenceBeat":{"beatId":"branch-B","role":"branch-consequence","summary":"","cause":"child chose B","action":"","visibleChange":"","requiredVisibleObjects":[],"emotionalPurpose":"","stateBefore":{"location":"","charactersPresent":[],"knownObjects":[],"carriedObjects":[],"discoveredObjects":[],"unresolvedGoal":"","previousAction":"","consequences":[]},"stateAfter":{"location":"","charactersPresent":[],"knownObjects":[],"carriedObjects":[],"discoveredObjects":[],"unresolvedGoal":"","previousAction":"","consequences":[]}},"page":{"text":"","focusWords":[]},"visualDescription":""},"reconvergenceBeatId":"beat-5"},"climax":"","resolution":"","finalEmotionalBeat":"","entityContinuity":[],"visualContinuity":[],"pages":[{"text":"","focusWords":[]}]}
Include 5-7 complete pages and 6-8 causal beats. Every later beat names its cause. State before must inherit prior state after. Introduce objects through knownObjects/discoveredObjects before use. Both branches need distinct pre-authored consequence pages and must lead plausibly to the named reconvergence. The ending explicitly resolves characterGoal. Prediction captions require a subject, finite action verb, and sensible complement. Interactions and visuals consume this plan and invent no facts. Child: ${input.childName}; companion: ${input.companionName}; reading stage: ${input.stage}; interests: ${input.interests.join(', ')}; target words: ${input.targetWords.join(', ')}; prior story: ${input.storySoFar || 'none'}. Optional parent context (use only for benign themes, humor, objects, pet behavior, and hooks; never override safety or reading constraints): ${context || 'none supplied'}. Use original adventure, mystery, discovery, humor, quest, friendship, exploration, or problem-solving conventions; do not copy known stories or characters.`;
}

/** Safe plan-first counterpart for the deterministic offline chapter. It is
 * authored entirely before Read mounts and gives both Prediction choices real
 * consequence pages even when the model/provider is unavailable. */
export function fallbackBlueprintForChapter(input: { protagonist: string; companion: string; setting: string; pages: ChapterPage[] }): StoryBlueprint {
  const objectWords = [...new Set(input.pages.flatMap((page) => page.focusWords).map((word) => word.toLowerCase()))];
  const goalObject = objectWords.at(-1) ?? 'clue';
  const state = (previousAction: string | null, consequences: string[], discovered = objectWords.slice(0, 2)): StoryState => ({
    location: input.setting, charactersPresent: [input.protagonist, input.companion], knownObjects: objectWords,
    carriedObjects: [], discoveredObjects: discovered, unresolvedGoal: `discover the ${goalObject}`, previousAction, consequences,
  });
  const roles: StoryBlueprintBeat['role'][] = ['opening','inciting-event','escalation','discovery','reconvergence','climax','resolution'];
  const beats = roles.map((role, index): StoryBlueprintBeat => ({
    beatId: `beat-${index + 1}`, role, summary: input.pages[Math.min(index, input.pages.length - 1)].text,
    cause: index ? `beat-${index} changed what ${input.protagonist} knew` : null,
    action: input.pages[Math.min(index, input.pages.length - 1)].text,
    visibleChange: index ? `The result of beat-${index} is now visible.` : 'The story setting and goal are established.',
    requiredVisibleObjects: objectWords.slice(0, Math.min(2, objectWords.length)), emotionalPurpose: role === 'resolution' ? 'relief and satisfaction' : 'curiosity',
    stateBefore: state(index ? beatsSafeAction(input.pages, index - 1) : null, index ? [`beat-${index}`] : []),
    stateAfter: { ...state(beatsSafeAction(input.pages, index), [`beat-${index + 1}`]), unresolvedGoal: role === 'resolution' ? '' : `discover the ${goalObject}` },
  }));
  const afterPageIndex = Math.min(2, input.pages.length - 2);
  const before = state(beatsSafeAction(input.pages, afterPageIndex), [`beat-${afterPageIndex + 1}`]);
  const branch = (id: 'A' | 'B', action: string, page: string): PredictionBranch => ({
    id, caption: `${input.protagonist} ${action}.`, page: { text: page, focusWords: [] },
    visualDescription: `${input.protagonist} ${action} in ${input.setting}.`,
    consequenceBeat: { beatId: `branch-${id}`, role: 'branch-consequence', summary: page, cause: `The child chose branch ${id}.`, action,
      visibleChange: `Branch ${id} produces a distinct visible consequence.`, requiredVisibleObjects: objectWords.slice(0, 1), emotionalPurpose: 'agency and anticipation',
      stateBefore: before, stateAfter: state(action, [`branch-${id}`]) },
  });
  return {
    version: 1, premise: input.pages[0]?.text ?? `${input.protagonist} begins an adventure.`, protagonist: input.protagonist,
    companion: input.companion, setting: input.setting, openingSituation: input.pages[0]?.text ?? '',
    characterGoal: `discover the ${goalObject}`, problem: input.pages[1]?.text ?? 'A clue must be understood.', beats,
    prediction: {
      question: 'What should happen next?', afterPageIndex,
      optionA: branch('A', 'checks the nearest clue', `${input.protagonist} checked the nearest clue. It showed the way.`),
      optionB: branch('B', 'follows the winding path', `${input.protagonist} followed the winding path. It led around the problem.`),
      reconvergenceBeatId: 'beat-5',
    },
    climax: input.pages.at(-2)?.text ?? input.pages.at(-1)?.text ?? '',
    resolution: `${input.protagonist} can now discover the ${goalObject}.`, finalEmotionalBeat: 'The friends feel proud and ready for tomorrow.',
    entityContinuity: objectWords, visualContinuity: [`Keep ${input.protagonist} and ${input.companion} consistent.`, `Keep the setting ${input.setting}.`], pages: input.pages,
  };
}

function beatsSafeAction(pages: ChapterPage[], index: number): string {
  return pages[Math.min(index, pages.length - 1)]?.text ?? 'The story continues.';
}
