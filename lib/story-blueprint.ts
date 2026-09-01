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

export const RESOLUTION_TYPES = ['discovery-fulfilled','problem-solved','successful-return','humorous-reversal','friendship-payoff','earned-celebration','mystery-partly-explained','object-used','new-skill-succeeds','safe-surprise','emotional-realization','unexpected-goal'] as const;
export type ResolutionType = (typeof RESOLUTION_TYPES)[number];

export interface StoryBlueprint {
  version: 1;
  premise: string;
  protagonist: string;
  companion: string | null;
  setting: string;
  openingSituation: string;
  characterGoal: string;
  /** Stable correspondence between the planned goal and its resolution. */
  goalId: string;
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
  goalResolutionStatus: 'resolved';
  goalResolutionBeatId: string;
  resolutionType?: ResolutionType;
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
const FINITE_VERBS = new Set([
  'appears','asks','begins','builds','carries','catches','checks','chooses','climbs','closes','comes','crosses','digs','drops',
  'finds','follows','gathers','gives','glows','hears','helps','holds','jumps','keeps','leads','lifts','looks','makes','moves',
  'opens','picks','places','points','pulls','pushes','reaches','reads','returns','rides','rolls','runs','sees','shines','shows',
  'slides','splashes','spots','steps','takes','taps','throws','turns','uses','waits','walks','waves','wears',
  'beg','build','carry','catch','chat','check','choose','clap','climb','close','cross','cut','dig','dip','drop','fill','find','fit','follow','get','give','grab','help','hit','hold','hop','hug','jump','kick','lift','look','make','move','nod','open','pack','pass','pat','pick','place','point','pop','pull','push','reach','read','return','ride','roll','run','see','set','show','sing','sit','slide','spot','step','take','tap','tell','throw','toss','tug','turn','use','wait','walk','wave','win',
]);

function isFiniteAction(word: string): boolean {
  if (FINITE_VERBS.has(word)) return true;
  const stems = word.endsWith('ies') ? [`${word.slice(0, -3)}y`] : word.endsWith('es') ? [word.slice(0, -2), word.slice(0, -1)] : word.endsWith('s') ? [word.slice(0, -1)] : [];
  return stems.some((stem) => FINITE_VERBS.has(stem) || FINITE_VERBS.has(`${stem}s`));
}

export function predictionCaptionIssues(caption: string, protagonist?: string): string[] {
  const clean = caption.trim();
  const words = clean.replace(/[.!?]+$/, '').split(/\s+/).filter(Boolean);
  const issues: string[] = [];
  if (words.length < 4) issues.push('too-short');
  if (!/^[A-Z][^!?]*[.!]$/.test(clean)) issues.push('not-complete-sentence');
  if (BAD_PREDICTION.some((pattern) => pattern.test(clean))) issues.push('fragment-or-placeholder');
  const subject = protagonist?.toLowerCase();
  if (subject && words[0]?.toLowerCase() !== subject) issues.push('missing-protagonist-subject');
  const candidateWords = words.slice(1).map((word) => word.toLowerCase().replace(/[^a-z]/g, ''));
  if (!candidateWords.some(isFiniteAction)) issues.push('missing-finite-action');
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
  if (!blueprint.premise || !blueprint.characterGoal || !blueprint.problem || !blueprint.goalId) add('missing-foundation', 'Premise, stable goal id, goal, and problem are required.');
  if (blueprint.pages.length < 5) add('page-count', 'A complete chapter needs at least five authored pages.');
  if (blueprint.beats.length < 6) add('beat-count', 'Opening through resolution must be planned before prose.');
  for (let index = 0; index < blueprint.beats.length; index += 1) {
    const beat = blueprint.beats[index];
    if (index > 0 && !beat.cause) add('missing-cause', `${beat.beatId} does not state what caused it.`);
    if (!beat.action || !beat.visibleChange) add('incomplete-beat', `${beat.beatId} lacks an action or visible change.`);
    if (beat.stateBefore.unresolvedGoal !== blueprint.beats[Math.max(0, index - 1)].stateAfter.unresolvedGoal && beat.role !== 'resolution') {
      add('goal-discontinuity', `${beat.beatId} changes the unresolved goal without resolution.`);
    }
    if (beat.role !== 'resolution' && (beat.stateBefore.unresolvedGoal !== blueprint.goalId || beat.stateAfter.unresolvedGoal !== blueprint.goalId)) {
      add('goal-discontinuity', `${beat.beatId} must retain the stable goal id.`);
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
  const resolutionBeat = blueprint.beats.find((beat) => beat.beatId === blueprint.goalResolutionBeatId);
  if (blueprint.goalResolutionStatus !== 'resolved' || !resolutionBeat || resolutionBeat.role !== 'resolution' || resolutionBeat.stateAfter.unresolvedGoal !== '') {
    add('unresolved-ending', 'The stable goal must point to a resolution beat whose state closes it.');
  }
  if (!blueprint.resolutionType || !RESOLUTION_TYPES.includes(blueprint.resolutionType)) add('resolution-type', 'A bounded resolution function is required.');
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

export interface StoryLiteracyContract {
  currentVocabulary: string[];
  previewVocabulary: string[];
  maxPreviewWords: number;
  sentenceLength: { min: number; max: number };
  approvedProperNouns: string[];
  targetWords: string[];
  actionVocabulary: string[];
}

export function blueprintGenerationPrompt(input: { childName: string; companionName: string; interests: string[]; childContext?: string; stage: number; targetWords: string[]; storySoFar?: string; recentStorySignatures?: string[]; literacy?: StoryLiteracyContract }): string {
  const context = input.childContext?.trim().slice(0, 1200);
  const actionA = input.literacy?.actionVocabulary[0] ?? 'tap';
  const actionB = input.literacy?.actionVocabulary.find((word) => word !== actionA) ?? 'pat';
  const captionObject = input.literacy?.targetWords[0] ?? input.literacy?.currentVocabulary.find((word) => word.length > 2) ?? 'map';
  return `Create one original Little Chapters story as STRICT JSON. Plan the complete causal chapter before prose. Return exactly this shape (no markdown):
{"version":1,"premise":"","protagonist":"","companion":"","setting":"","openingSituation":"","characterGoal":"","goalId":"goal-1","problem":"","beats":[{"beatId":"beat-1","role":"opening|inciting-event|escalation|discovery|reconvergence|climax|resolution","summary":"","cause":null,"action":"","visibleChange":"","requiredVisibleObjects":[],"emotionalPurpose":"","stateBefore":{"location":"","charactersPresent":[],"knownObjects":[],"carriedObjects":[],"discoveredObjects":[],"unresolvedGoal":"goal-1","previousAction":null,"consequences":[]},"stateAfter":{"location":"","charactersPresent":[],"knownObjects":[],"carriedObjects":[],"discoveredObjects":[],"unresolvedGoal":"goal-1","previousAction":"","consequences":[]}}],"prediction":{"question":"What should happen next?","afterPageIndex":2,"optionA":{"id":"A","caption":"${input.childName} can ${actionA} the ${captionObject}.","consequenceBeat":{"beatId":"branch-A","role":"branch-consequence","summary":"","cause":"child chose A","action":"","visibleChange":"","requiredVisibleObjects":[],"emotionalPurpose":"","stateBefore":{"location":"","charactersPresent":[],"knownObjects":[],"carriedObjects":[],"discoveredObjects":[],"unresolvedGoal":"goal-1","previousAction":"","consequences":[]},"stateAfter":{"location":"","charactersPresent":[],"knownObjects":[],"carriedObjects":[],"discoveredObjects":[],"unresolvedGoal":"goal-1","previousAction":"","consequences":[]}},"page":{"text":"","focusWords":[]},"visualDescription":""},"optionB":{"id":"B","caption":"${input.childName} can ${actionB} the ${captionObject}.","consequenceBeat":{"beatId":"branch-B","role":"branch-consequence","summary":"","cause":"child chose B","action":"","visibleChange":"","requiredVisibleObjects":[],"emotionalPurpose":"","stateBefore":{"location":"","charactersPresent":[],"knownObjects":[],"carriedObjects":[],"discoveredObjects":[],"unresolvedGoal":"goal-1","previousAction":"","consequences":[]},"stateAfter":{"location":"","charactersPresent":[],"knownObjects":[],"carriedObjects":[],"discoveredObjects":[],"unresolvedGoal":"goal-1","previousAction":"","consequences":[]}},"page":{"text":"","focusWords":[]},"visualDescription":""},"reconvergenceBeatId":"beat-5"},"climax":"","resolution":"","goalResolutionStatus":"resolved","goalResolutionBeatId":"beat-7","resolutionType":"problem-solved","finalEmotionalBeat":"","entityContinuity":[],"visualContinuity":[],"pages":[{"text":"","focusWords":[]}]}
Include 5-7 complete pages and 6-8 causal beats. Every later beat names its cause. Use goalId "goal-1" in unresolvedGoal until the final resolution beat; that beat must have stateAfter.unresolvedGoal="", goalResolutionStatus="resolved", and goalResolutionBeatId equal to its beatId. State before inherits prior state after. List each newly visible object in discoveredObjects on the beat where it first appears; code will normalize inherited state. Both branches need distinct pre-authored consequence pages and must reconverge plausibly. Prediction captions must start with ${input.childName}, use a clear finite action, include a meaningful object/place complement, and end with a period. The ending explicitly resolves characterGoal. Choose one resolutionType from: ${RESOLUTION_TYPES.join(', ')}. This is a story function, never prose to display. Vary premise, conflict, companion role, Prediction shape, climax and resolution; the blueprint is a scaffold, not a fill-in-the-blanks template. Avoid repeating any recent signature unless continuity requires it: ${(input.recentStorySignatures ?? []).join(' | ') || 'none'}.
LITERACY CONTRACT (applies to pages, both branch pages/captions, summaryLine and final emotional beat): use only CURRENT VOCABULARY plus at most ${input.literacy?.maxPreviewWords ?? 2} distinct words from PREVIEW VOCABULARY. Every sentence must contain ${input.literacy?.sentenceLength.min ?? 5}-${input.literacy?.sentenceLength.max ?? 9} words. CURRENT VOCABULARY: ${(input.literacy?.currentVocabulary ?? input.targetWords).join(', ')}. PREVIEW VOCABULARY: ${(input.literacy?.previewVocabulary ?? []).join(', ') || 'none'}. APPROVED PROPER NOUNS ONLY: ${(input.literacy?.approvedProperNouns ?? [input.childName, input.companionName]).join(', ')}. Never invent another capitalized person, character, brand, or place name; use generic lowercase places such as the park, the hill, the train station, or the garden. LEGAL TARGET WORDS: ${(input.literacy?.targetWords ?? input.targetWords).join(', ') || 'none'}. LEGAL ACTION WORDS FOR "${input.childName} can ..." CAPTIONS: ${(input.literacy?.actionVocabulary ?? []).join(', ')}.
Interactions and visuals consume this plan and invent no facts. Child: ${input.childName}; companion: ${input.companionName}; reading stage: ${input.stage}; interests: ${input.interests.join(', ')}; prior story: ${input.storySoFar || 'none'}. Optional parent context (benign themes, humor, objects, pet behavior, and hooks only; never override safety or reading constraints): ${context || 'none supplied'}. Use original adventure, mystery, discovery, humor, quest, friendship, exploration, or problem-solving conventions; do not copy known stories or characters.`;
}

/** Derive inherited state mechanically so the model authors changes rather
 * than repeatedly copying a fragile full-state snapshot. */
export function normalizeStoryBlueprint(blueprint: StoryBlueprint): StoryBlueprint {
  const goalId = blueprint.goalId;
  let previous: StoryState | null = null;
  const beats = blueprint.beats.map((beat) => {
    const before = previous ? { ...previous, consequences: [...previous.consequences] } : { ...beat.stateBefore, unresolvedGoal: goalId };
    const discovered = [...new Set([...before.discoveredObjects, ...beat.stateAfter.discoveredObjects, ...beat.requiredVisibleObjects.filter((object) => !before.knownObjects.includes(object) && !before.carriedObjects.includes(object))])];
    const after: StoryState = {
      ...before, ...beat.stateAfter,
      charactersPresent: [...new Set([...before.charactersPresent, ...beat.stateAfter.charactersPresent])],
      knownObjects: [...new Set([...before.knownObjects, ...beat.stateAfter.knownObjects])],
      carriedObjects: [...new Set(beat.stateAfter.carriedObjects)], discoveredObjects: discovered,
      unresolvedGoal: beat.role === 'resolution' ? '' : goalId,
    };
    previous = after;
    return { ...beat, stateBefore: before, stateAfter: after };
  });
  return { ...blueprint, beats };
}

/** Safe plan-first counterpart for the deterministic offline chapter. It is
 * authored entirely before Read mounts and gives both Prediction choices real
 * consequence pages even when the model/provider is unavailable. */
export function fallbackBlueprintForChapter(input: { protagonist: string; companion: string; setting: string; pages: ChapterPage[] }): StoryBlueprint {
  const objectWords = [...new Set(input.pages.flatMap((page) => page.focusWords).map((word) => word.toLowerCase()))];
  const goalObject = objectWords.at(-1) ?? 'clue';
  const state = (previousAction: string | null, consequences: string[], discovered = objectWords.slice(0, 2)): StoryState => ({
    location: input.setting, charactersPresent: [input.protagonist, input.companion], knownObjects: objectWords,
    carriedObjects: [], discoveredObjects: discovered, unresolvedGoal: 'goal-1', previousAction, consequences,
  });
  const roles: StoryBlueprintBeat['role'][] = ['opening','inciting-event','escalation','discovery','reconvergence','climax','resolution'];
  const beats = roles.map((role, index): StoryBlueprintBeat => ({
    beatId: `beat-${index + 1}`, role, summary: input.pages[Math.min(index, input.pages.length - 1)].text,
    cause: index ? `beat-${index} changed what ${input.protagonist} knew` : null,
    action: input.pages[Math.min(index, input.pages.length - 1)].text,
    visibleChange: index ? `The result of beat-${index} is now visible.` : 'The story setting and goal are established.',
    requiredVisibleObjects: objectWords.slice(0, Math.min(2, objectWords.length)), emotionalPurpose: role === 'resolution' ? 'relief and satisfaction' : 'curiosity',
    stateBefore: state(index ? beatsSafeAction(input.pages, index - 1) : null, index ? [`beat-${index}`] : []),
    stateAfter: { ...state(beatsSafeAction(input.pages, index), [`beat-${index + 1}`]), unresolvedGoal: role === 'resolution' ? '' : 'goal-1' },
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
  const resolutionType = RESOLUTION_TYPES[Math.abs(hashText(`${input.protagonist}|${input.setting}|${input.pages.map((page) => page.text).join('|')}`)) % RESOLUTION_TYPES.length];
  return {
    version: 1, premise: input.pages[0]?.text ?? `${input.protagonist} begins an adventure.`, protagonist: input.protagonist,
    companion: input.companion, setting: input.setting, openingSituation: input.pages[0]?.text ?? '',
    characterGoal: `discover the ${goalObject}`, goalId: 'goal-1', problem: input.pages[1]?.text ?? 'A clue must be understood.', beats,
    prediction: {
      question: 'What should happen next?', afterPageIndex,
      optionA: branch('A', 'checks the nearest clue', `${input.protagonist} checked the nearest clue. It showed the way.`),
      optionB: branch('B', 'follows the winding path', `${input.protagonist} followed the winding path. It led around the problem.`),
      reconvergenceBeatId: 'beat-5',
    },
    climax: input.pages.at(-2)?.text ?? input.pages.at(-1)?.text ?? '',
    resolution: `${input.protagonist} can now discover the ${goalObject}.`, goalResolutionStatus: 'resolved', goalResolutionBeatId: 'beat-7', resolutionType, finalEmotionalBeat: fallbackEmotionalBeat(resolutionType, input.protagonist),
    entityContinuity: objectWords, visualContinuity: [`Keep ${input.protagonist} and ${input.companion} consistent.`, `Keep the setting ${input.setting}.`], pages: input.pages,
  };
}

function hashText(value: string): number { let hash = 0; for (const char of value) hash = ((hash * 31) + char.charCodeAt(0)) | 0; return hash; }
function fallbackEmotionalBeat(type: ResolutionType, protagonist: string): string {
  if (type === 'humorous-reversal' || type === 'safe-surprise') return `${protagonist} laughs at the safe surprise.`;
  if (type === 'friendship-payoff') return `${protagonist} and the story friend solve it together.`;
  if (type === 'successful-return') return `${protagonist} returns safely with the answer.`;
  if (type === 'new-skill-succeeds') return `${protagonist} uses a new skill and succeeds.`;
  return `${protagonist} reaches the goal and feels ready for a new adventure.`;
}

function beatsSafeAction(pages: ChapterPage[], index: number): string {
  return pages[Math.min(index, pages.length - 1)]?.text ?? 'The story continues.';
}
