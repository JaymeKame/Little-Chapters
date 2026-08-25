import type { Chapter } from './chapters';

export type StoryMechanicType = 'find-sound' | 'what-happens-next' | 'word-builder' | 'final-story-unlock';

export interface ChapterVisualBible {
  style: string;
  protagonist: string;
  companion: string | null;
  environment: string;
  palette: string[];
  continuityRules: string[];
  forbiddenStyles: string[];
}

export interface StoryScene {
  sceneId: string;
  pageIndexes: number[];
  visualPurpose: 'opening' | 'discovery' | 'choice' | 'payoff';
  visualPrompt: string;
}

export interface InteractiveObject {
  objectId: string;
  label: string;
  spokenLabel: string;
  visualSceneId: string;
  visualCue: 'word-object' | 'scene-crop';
}

export interface StoryInteractionBeat {
  beatId: string;
  mechanicType: StoryMechanicType;
  literacyTarget: string | null;
  spokenInstruction: string;
  storyEntities: string[];
  visualSceneId: string;
  interactiveObjects: InteractiveObject[];
  correctTarget: string | null;
  successStoryAction: string;
  spokenSuccess: string;
  transitionTarget: string;
}

export interface StoryInteractionManifest {
  version: 1;
  chapterId: string;
  visualBible: ChapterVisualBible;
  scenes: StoryScene[];
  beats: StoryInteractionBeat[];
}

const CACHE_PREFIX = 'little-chapters-interaction-manifest:';
const STOP_WORDS = new Set(['the','and','was','with','from','that','this','then','there','what','could','something','little','today','tomorrow','inside','across']);
const NON_VISUAL_WORDS = new Set(['soft','loud','big','tiny','very','still','calm','bright','fine','fast','slow','found','looked','kept','came','went','said','heard','began','open','shut','move','moved','moving','out','back','more','before','again','red','blue','green','gold','old','small']);

function storyWords(chapter: Chapter): string[] {
  const focused = chapter.pages.flatMap((page) => page.focusWords);
  const spoken = chapter.pages.flatMap((page) => page.text.toLowerCase().match(/[a-z']+/g) ?? []);
  return [...new Set([...focused, ...spoken].map((word) => word.toLowerCase()).filter((word) => word.length > 2 && !STOP_WORDS.has(word)))];
}

function sceneGroups(pageCount: number): number[][] {
  const sceneCount = Math.min(4, Math.max(3, pageCount - 1));
  return Array.from({ length: sceneCount }, (_, scene) =>
    Array.from({ length: pageCount }, (_, page) => page).filter((page) => Math.min(sceneCount - 1, Math.floor(page * sceneCount / pageCount)) === scene),
  ).filter((group) => group.length);
}

function sceneForPage(scenes: StoryScene[], pageIndex: number): string {
  return scenes.find((scene) => scene.pageIndexes.includes(pageIndex))?.sceneId ?? scenes[0].sceneId;
}

const COMMON_GRAPHEMES = ['tch','igh','sh','ch','th','wh','ck','ng','ee','oo','ai','oa','er','ar','or'];
export function wordBuilderPieces(word: string): string[] {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  const pieces: string[] = [];
  for (let index = 0; index < clean.length;) {
    const grapheme = COMMON_GRAPHEMES.find((item) => clean.startsWith(item, index)) ?? clean[index];
    pieces.push(grapheme); index += grapheme.length;
  }
  return pieces;
}

export function buildStoryInteractionManifest(chapter: Chapter): StoryInteractionManifest {
  const entities = storyWords(chapter);
  const groups = sceneGroups(chapter.pages.length);
  const purposes: StoryScene['visualPurpose'][] = ['opening', 'discovery', 'choice', 'payoff'];
  const bible: ChapterVisualBible = {
    style: "warm, whimsical, handcrafted children's storybook illustration; calm shapes; highly legible focal objects",
    protagonist: chapter.character,
    companion: chapter.companion && chapter.companion !== chapter.character ? chapter.companion : null,
    environment: chapter.setting,
    palette: chapter.ambience === 'ocean' ? ['turquoise','coral','sunlit gold'] : chapter.ambience === 'space' ? ['indigo','soft violet','starlight gold'] : ['leaf green','sky blue','warm gold'],
    continuityRules: ['Keep character appearance and clothing identical across scenes.', 'Keep important story objects recognizable.', 'Maintain one coherent environment and palette.', 'Leave clear touch targets unobscured.'],
    forbiddenStyles: ['photorealism', 'horror', 'neon game UI', 'embedded text', 'inconsistent character redesign'],
  };
  const scenes: StoryScene[] = groups.map((pageIndexes, index) => ({
    sceneId: `scene-${index + 1}`,
    pageIndexes,
    visualPurpose: purposes[Math.min(index, purposes.length - 1)],
    visualPrompt: `${bible.style}. ${chapter.setting}. Palette: ${bible.palette.join(', ')}. Show the story moment: ${pageIndexes.map((page) => chapter.pages[page].text).join(' ')} Continuity: ${bible.continuityRules.join(' ')} Avoid: ${bible.forbiddenStyles.join(', ')}.`,
  }));

  const soundGroup = chapter.phonics.find((group) => group.words.some((word) => entities.includes(word.toLowerCase())));
  const soundAnswer = soundGroup?.words.find((word) => entities.includes(word.toLowerCase()))?.toLowerCase() ?? entities[0] ?? 'story';
  const hinted = soundGroup?.hint.toLowerCase().match(/[a-z]+/)?.[0] ?? soundAnswer[0];
  const sound = soundAnswer.includes(hinted) ? hinted : soundAnswer[0];
  const distractors = entities.filter((word) => word !== soundAnswer && !word.includes(sound)).slice(0, 2);
  while (distractors.length < 2) distractors.push(['look','find','go'][distractors.length]);
  const soundChoices = [distractors[0], soundAnswer, distractors[1]];
  const visualEntities = entities.filter((word) => word !== soundAnswer && word !== chapter.character.toLowerCase() && !NON_VISUAL_WORDS.has(word));
  const settingEntities = (chapter.setting.toLowerCase().match(/[a-z']+/g) ?? []).filter((word) => word.length > 3 && !STOP_WORDS.has(word) && !NON_VISUAL_WORDS.has(word));
  const predictionEntities = [chapter.character.toLowerCase(), settingEntities.at(-1) ?? visualEntities[0] ?? soundAnswer];
  const lastPage = chapter.pages.length - 1;
  const finalTarget = chapter.pages[lastPage]?.focusWords.at(-1)?.toLowerCase() ?? entities.at(-1) ?? soundAnswer;
  const builderTarget = chapter.pages.slice(1, -1).flatMap((page) => page.focusWords)
    .map((word) => word.toLowerCase()).find((word) => /^[a-z]{3,6}$/.test(word)) ?? soundAnswer;
  const builderPieces = wordBuilderPieces(builderTarget);

  const beats: StoryInteractionBeat[] = [
    {
      beatId: 'find-sound', mechanicType: 'find-sound', literacyTarget: sound,
      spokenInstruction: `Listen. Which one has ${sound}?`, storyEntities: soundChoices,
      visualSceneId: sceneForPage(scenes, Math.max(0, Math.floor(chapter.pages.length / 3) - 1)),
      interactiveObjects: soundChoices.map((label, index) => ({ objectId: `sound-${index}`, label, spokenLabel: label, visualSceneId: sceneForPage(scenes, 1), visualCue: 'word-object' })),
      correctTarget: soundAnswer, successStoryAction: `The ${soundAnswer} clue responds and the story moves on.`,
      spokenSuccess: `You found ${sound} in ${soundAnswer}.`, transitionTarget: 'reading-2',
    },
    {
      beatId: 'prediction', mechanicType: 'what-happens-next', literacyTarget: null,
      spokenInstruction: 'What do you think happens next?', storyEntities: predictionEntities,
      visualSceneId: sceneForPage(scenes, Math.max(1, Math.floor(chapter.pages.length * 2 / 3))),
      interactiveObjects: predictionEntities.map((label, index) => ({ objectId: `prediction-${index}`, label, spokenLabel: label, visualSceneId: scenes[Math.min(scenes.length - 1, Math.max(1, index + 1))].sceneId, visualCue: 'scene-crop' })),
      correctTarget: null, successStoryAction: 'The selected possibility glows, then the canonical story continues.',
      spokenSuccess: 'Ooh, maybe! Let’s see.', transitionTarget: 'reading-3',
    },
    {
      beatId: 'word-builder', mechanicType: 'word-builder', literacyTarget: builderTarget,
      spokenInstruction: `Let’s build ${builderTarget} to move the story.`, storyEntities: [builderTarget],
      visualSceneId: sceneForPage(scenes, Math.max(1, lastPage - 1)),
      interactiveObjects: builderPieces.map((label, index) => ({ objectId: `word-part-${index}`, label, spokenLabel: label, visualSceneId: sceneForPage(scenes, lastPage - 1), visualCue: 'word-object' })),
      correctTarget: builderTarget, successStoryAction: `The ${builderTarget} makes the story world respond.`,
      spokenSuccess: `${builderTarget}! You built it.`, transitionTarget: 'final-unlock',
    },
    {
      beatId: 'final-unlock', mechanicType: 'final-story-unlock', literacyTarget: finalTarget,
      spokenInstruction: 'This last word unlocks what happens next.', storyEntities: [finalTarget],
      visualSceneId: scenes.at(-1)!.sceneId,
      interactiveObjects: [{ objectId: 'final-word', label: finalTarget, spokenLabel: finalTarget, visualSceneId: scenes.at(-1)!.sceneId, visualCue: 'word-object' }],
      correctTarget: finalTarget, successStoryAction: chapter.cliffhanger[0],
      spokenSuccess: `${chapter.cliffhanger[0]} Whoa. We’ll find out more tomorrow.`, transitionTarget: 'ending',
    },
  ];
  return { version: 1, chapterId: chapter.id, visualBible: bible, scenes, beats };
}

export function resolveStoryInteractionManifest(chapter: Chapter): StoryInteractionManifest {
  if (typeof localStorage !== 'undefined') {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_PREFIX + chapter.id) ?? 'null') as StoryInteractionManifest | null;
      if (cached?.version === 1 && cached.chapterId === chapter.id) return cached;
    } catch { /* regenerate a malformed local record */ }
  }
  const manifest = buildStoryInteractionManifest(chapter);
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem(CACHE_PREFIX + chapter.id, JSON.stringify(manifest)); } catch { /* best effort */ }
  }
  return manifest;
}
