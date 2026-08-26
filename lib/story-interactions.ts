import type { Chapter } from './chapters';
import { predictionCaptionIssues, storyBeatVisualPrompt } from './story-blueprint.ts';

export type StoryMechanicType = 'find-sound' | 'find-it-in-scene' | 'what-happens-next' | 'word-builder' | 'story-order' | 'final-story-unlock';

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
  narrativeBeat: string;
  charactersPresent: string[];
  importantAction: string;
  importantObjects: string[];
  location: string;
  emotionalTone: string;
  previousSceneContinuity: string | null;
  interactionBeatIds: string[];
}

export interface InteractiveObject {
  objectId: string;
  label: string;
  spokenLabel: string;
  visualSceneId: string;
  visualCue: 'word-object' | 'scene-crop';
  /** Correction pass 2, Section 4: for prediction beats specifically, a full
   *  grammatically-valid sentence describing the possible next-story action.
   *  Renderers display `caption ?? label` so single-word tokens (find-sound,
   *  find-in-scene, word-builder) are unchanged, but prediction shows a
   *  complete, plausible outcome instead of a bare noun. */
  caption?: string;
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
  version: 2;
  contentRevision: 4;
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

/* ── Prediction sentence construction (Correction pass 2, Section 4) ──────
 * Physical testing surfaced malformed prediction tiles like "Mike happened
 * next?" — the result of a single-word noun label being displayed under a
 * "What do you think happens next?" prompt. The child interprets that as a
 * grammatical fragment. Predictions now render as SHORT COMPLETE SENTENCES
 * built deterministically from the chapter's own visible entities + a small
 * pool of story-neutral verb templates that read as plausible next-story
 * actions. Every constructed caption is validated before use; anything that
 * fails validation is replaced by a hand-authored fallback shape. */

interface PredictionOption { tokenLabel: string; caption: string }

const PREDICTION_TEMPLATES: Array<(subject: string, object: string) => string> = [
  (subject, object) => `${capitalize(subject)} follows the ${object}.`,
  (subject, object) => `${capitalize(subject)} finds a new ${object}.`,
  (subject, object) => `Something moves behind the ${object}.`,
  (subject, object) => `${capitalize(subject)} steps closer to the ${object}.`,
  (subject, object) => `A ${object} shows a hidden path.`,
];

/** Validate a prediction caption for a young reader — reject malformed AI
 *  or template artifacts. */
export function isValidPredictionCaption(text: string): boolean {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length < 8) return false;
  const words = trimmed.replace(/[.!?]+$/, '').split(/\s+/).filter(Boolean);
  if (words.length < 3 || words.length > 12) return false;
  const lower = trimmed.toLowerCase();
  // Template / generation artifacts observed in the physical device test.
  if (/happened next\??$/.test(lower)) return false;
  if (/^(the )?next thing/.test(lower)) return false;
  if (/^what (happens|happened) next/.test(lower)) return false;
  if (/^something happens\.?$/.test(lower)) return false;
  if (/^[a-z]+ next\.?$/.test(lower)) return false;
  // Repeats itself.
  const uniqueWords = new Set(words.map((word) => word.toLowerCase()));
  if (uniqueWords.size < Math.ceil(words.length * 0.7)) return false;
  // Must contain a verb-shaped word: any non-stopword ≥3 chars other than
  // the subject/object satisfies the check for this small template pool.
  const verbCandidates = words.slice(1, -1).filter((word) => word.length >= 3 && !STOP_WORDS.has(word.toLowerCase()));
  if (verbCandidates.length === 0) return false;
  // First character capitalized (sentence-shaped).
  if (!/^[A-Z]/.test(trimmed)) return false;
  // Ends with a full stop or exclamation (never a question — the tutor asks
  // the question; the tiles are answers).
  if (!/[.!]$/.test(trimmed)) return false;
  return predictionCaptionIssues(trimmed).length === 0;
}

function capitalize(text: string): string {
  if (!text) return text;
  return text[0].toUpperCase() + text.slice(1);
}

/** Deterministic hand-authored fallback captions — used when nothing in the
 *  chapter's entities produces a validated sentence. Both captions are always
 *  grammatical, plausible, and meaningfully different. */
function fallbackPredictionCaptions(chapter: Chapter): PredictionOption[] {
  const character = capitalize(chapter.character || 'The reader');
  return [
    { tokenLabel: chapter.character.toLowerCase() || 'follows', caption: `${character} follows the next clue.` },
    { tokenLabel: 'reveal', caption: 'Something new appears in the story.' },
  ];
}

function buildPredictionCaptions(
  chapter: Chapter,
  visualEntities: string[],
  settingEntities: string[],
  soundAnswer: string,
): PredictionOption[] {
  const character = chapter.character || 'the reader';
  const nouns = [...visualEntities, ...settingEntities, soundAnswer]
    .filter((word): word is string => typeof word === 'string' && word.length >= 3 && !STOP_WORDS.has(word.toLowerCase()) && !NON_VISUAL_WORDS.has(word.toLowerCase()));
  const uniqueNouns = [...new Set(nouns.map((word) => word.toLowerCase()))].filter((word) => word !== character.toLowerCase());
  const options: PredictionOption[] = [];
  const seenCaptions = new Set<string>();
  const seenTokens = new Set<string>();
  // Try each noun through each template; keep the first two DIFFERENT, VALID
  // captions we can produce. Different means different template + different
  // primary noun so the two tiles are meaningfully distinct.
  const usedTemplates = new Set<number>();
  const usedNouns = new Set<string>();
  outer: for (let templateIndex = 0; templateIndex < PREDICTION_TEMPLATES.length && options.length < 2; templateIndex++) {
    if (usedTemplates.has(templateIndex)) continue;
    for (const noun of uniqueNouns) {
      if (usedNouns.has(noun)) continue;
      const caption = PREDICTION_TEMPLATES[templateIndex](character, noun);
      if (!isValidPredictionCaption(caption)) continue;
      if (seenCaptions.has(caption.toLowerCase())) continue;
      const tokenLabel = noun;
      if (seenTokens.has(tokenLabel)) continue;
      seenCaptions.add(caption.toLowerCase());
      seenTokens.add(tokenLabel);
      usedTemplates.add(templateIndex);
      usedNouns.add(noun);
      options.push({ tokenLabel, caption });
      if (options.length >= 2) break outer;
    }
  }
  if (options.length >= 2) return options.slice(0, 2);
  // Not enough nouns to produce two distinct valid captions — fill with
  // hand-authored fallbacks. Never render an unvalidated caption.
  const fallback = fallbackPredictionCaptions(chapter);
  for (const option of fallback) {
    if (options.length >= 2) break;
    if (seenTokens.has(option.tokenLabel)) continue;
    options.push(option);
    seenTokens.add(option.tokenLabel);
  }
  return options.slice(0, 2);
}

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
  const scenes: StoryScene[] = groups.map((pageIndexes, index) => {
    const narrativeBeat = pageIndexes.map((page) => chapter.pages[page].text).join(' ');
    const importantObjects = storyWords({ ...chapter, pages: pageIndexes.map((page) => chapter.pages[page]) }).slice(0, 5);
    const blueprintBeat = chapter.storyBlueprint?.beats[Math.min(index, chapter.storyBlueprint.beats.length - 1)];
    return {
    sceneId: `scene-${index + 1}`,
    pageIndexes,
    visualPurpose: purposes[Math.min(index, purposes.length - 1)],
    narrativeBeat,
    charactersPresent: [chapter.character, ...(bible.companion ? [bible.companion] : [])],
    importantAction: narrativeBeat,
    importantObjects,
    location: chapter.setting,
    emotionalTone: index === groups.length - 1 ? 'wonder and satisfying discovery' : index === 0 ? 'curious anticipation' : 'playful discovery',
    previousSceneContinuity: index ? `Continue directly from scene-${index}; preserve every character, object, clothing detail, light direction, and environment.` : null,
    interactionBeatIds: [],
    visualPrompt: blueprintBeat && chapter.storyBlueprint
      ? `${bible.style}. ${storyBeatVisualPrompt(chapter.storyBlueprint, blueprintBeat)} Palette: ${bible.palette.join(', ')}. Avoid: ${bible.forbiddenStyles.join(', ')}.`
      : `${bible.style}. CURRENT NARRATIVE BEAT: ${narrativeBeat} Characters present: ${chapter.character}${bible.companion ? ` and ${bible.companion}` : ''}. Important action now: ${narrativeBeat}. Important objects: ${importantObjects.join(', ')}. Location: ${chapter.setting}. Emotional tone: ${index === groups.length - 1 ? 'wonder and satisfying discovery' : 'playful curiosity'}. Palette: ${bible.palette.join(', ')}. ${index ? `Continue directly from the preceding panel with identical characters, clothing, objects, environment and lighting.` : ''} Continuity: ${bible.continuityRules.join(' ')} Avoid: ${bible.forbiddenStyles.join(', ')}.`,
  }; });

  const soundGroup = chapter.phonics.find((group) => group.words.some((word) => entities.includes(word.toLowerCase())));
  const soundAnswer = soundGroup?.words.find((word) => entities.includes(word.toLowerCase()))?.toLowerCase() ?? entities[0] ?? 'story';
  const hinted = soundGroup?.hint.toLowerCase().match(/[a-z]+/)?.[0] ?? soundAnswer[0];
  const sound = soundAnswer.includes(hinted) ? hinted : soundAnswer[0];
  const distractors = entities.filter((word) => word !== soundAnswer && !word.includes(sound)).slice(0, 2);
  while (distractors.length < 2) distractors.push(['look','find','go'][distractors.length]);
  const soundChoices = [distractors[0], soundAnswer, distractors[1]];
  const visualEntities = entities.filter((word) => word !== soundAnswer && word !== chapter.character.toLowerCase() && !NON_VISUAL_WORDS.has(word));
  const settingEntities = (chapter.setting.toLowerCase().match(/[a-z']+/g) ?? []).filter((word) => word.length > 3 && !STOP_WORDS.has(word) && !NON_VISUAL_WORDS.has(word));
  // Correction pass 2, Section 4: prediction choices are FULL SENTENCES —
  // grammatical, plausible next-story actions — not bare-noun tokens. See
  // buildPredictionCaptions below.
  const authoredBranches = chapter.storyBlueprint
    ? [chapter.storyBlueprint.prediction.optionA, chapter.storyBlueprint.prediction.optionB]
        .filter((branch) => predictionCaptionIssues(branch.caption, chapter.character).length === 0)
        .map((branch) => ({ tokenLabel: branch.id, caption: branch.caption }))
    : [];
  const predictionCaptions = authoredBranches.length === 2 ? authoredBranches : buildPredictionCaptions(chapter, visualEntities, settingEntities, soundAnswer);
  const predictionEntities = predictionCaptions.map((row) => row.tokenLabel);
  const lastPage = chapter.pages.length - 1;
  const finalTarget = chapter.pages[lastPage]?.focusWords.at(-1)?.toLowerCase() ?? entities.at(-1) ?? soundAnswer;
  const builderTarget = chapter.pages.slice(1, -1).flatMap((page) => page.focusWords)
    .map((word) => word.toLowerCase()).find((word) => /^[a-z]{3,6}$/.test(word)) ?? soundAnswer;
  const builderPieces = wordBuilderPieces(builderTarget);

  const beats: StoryInteractionBeat[] = [
    {
      beatId: 'find-sound', mechanicType: 'find-sound', literacyTarget: sound,
      // Natural word modeling instead of the naked phoneme. TTS speaking a
      // bare "TH" sounds robotic and unhelpful; anchoring the sound inside
      // a real word the child recognises (the correct answer) is the same
      // pattern any classroom phonics session uses — "Listen: thumb…
      // th…umb. Can you hear the th? Which one?" — and it stays legitimate
      // teaching, not a giveaway, because the child still has to MATCH the
      // heard word to one of the visible tiles. Success line likewise
      // never voices the phoneme in isolation.
      spokenInstruction: 'Listen to these words, then choose the story word that starts the same way.',
      storyEntities: soundChoices,
      visualSceneId: sceneForPage(scenes, Math.max(0, Math.floor(chapter.pages.length / 3) - 1)),
      interactiveObjects: soundChoices.map((label, index) => ({ objectId: `sound-${index}`, label, spokenLabel: label, visualSceneId: sceneForPage(scenes, 1), visualCue: 'word-object' })),
      correctTarget: soundAnswer, successStoryAction: `You matched ${soundAnswer} by its beginning sound.`,
      spokenSuccess: `Yes — ${soundAnswer}.`, transitionTarget: 'reading-2',
    },
    {
      beatId: 'find-in-scene', mechanicType: 'find-it-in-scene', literacyTarget: visualEntities[0] ?? soundAnswer,
      spokenInstruction: `Can you find ${visualEntities[0] ?? soundAnswer}?`,
      storyEntities: [visualEntities[0] ?? soundAnswer], visualSceneId: sceneForPage(scenes, Math.max(1, Math.floor(chapter.pages.length / 2))),
      interactiveObjects: [{ objectId: 'scene-target', label: visualEntities[0] ?? soundAnswer, spokenLabel: visualEntities[0] ?? soundAnswer, visualSceneId: sceneForPage(scenes, Math.max(1, Math.floor(chapter.pages.length / 2))), visualCue: 'scene-crop' }],
      correctTarget: visualEntities[0] ?? soundAnswer, successStoryAction: `You found ${visualEntities[0] ?? soundAnswer}.`,
      spokenSuccess: `You found it. Now let’s see what happens next.`, transitionTarget: 'reading-3',
    },
    {
      beatId: 'prediction', mechanicType: 'what-happens-next', literacyTarget: null,
      spokenInstruction: 'What do you think happens next?', storyEntities: predictionEntities,
      visualSceneId: sceneForPage(scenes, Math.max(1, Math.floor(chapter.pages.length * 2 / 3))),
      interactiveObjects: predictionCaptions.map((row, index) => ({
        objectId: `prediction-${index}`,
        label: row.tokenLabel,
        spokenLabel: row.caption,
        visualSceneId: scenes[Math.min(scenes.length - 1, Math.max(1, index + 1))].sceneId,
        visualCue: 'scene-crop',
        caption: row.caption,
      })),
      correctTarget: null, successStoryAction: 'You chose what might happen next.',
      spokenSuccess: 'Ooh, maybe! Let’s see.', transitionTarget: 'reading-3',
    },
    {
      beatId: 'word-builder', mechanicType: 'word-builder', literacyTarget: builderTarget,
      spokenInstruction: `Let’s build ${builderTarget} to move the story.`, storyEntities: [builderTarget],
      visualSceneId: sceneForPage(scenes, Math.max(1, lastPage - 1)),
      interactiveObjects: builderPieces.map((label, index) => ({ objectId: `word-part-${index}`, label, spokenLabel: label, visualSceneId: sceneForPage(scenes, lastPage - 1), visualCue: 'word-object' })),
      correctTarget: builderTarget, successStoryAction: `You completed ${builderTarget}.`,
      spokenSuccess: `${builderTarget}! You built the word. Back to the story.`, transitionTarget: 'final-unlock',
    },
    {
      beatId: 'story-order', mechanicType: 'story-order', literacyTarget: null,
      spokenInstruction: 'Think back. What happened first?',
      storyEntities: chapter.pages.slice(0, Math.min(chapter.pages.length, 4)).map((page) => page.text),
      visualSceneId: sceneForPage(scenes, Math.min(1, lastPage)),
      interactiveObjects: chapter.pages.slice(0, Math.min(chapter.pages.length, stageEventCount(chapter))).map((page, index) => ({
        objectId: `story-event-${index}`, label: index === 0 ? 'first' : `event-${index + 1}`,
        spokenLabel: shortEventCaption(page.text), caption: shortEventCaption(page.text),
        visualSceneId: sceneForPage(scenes, Math.min(index, lastPage)), visualCue: 'word-object' as const,
      })).reverse(),
      correctTarget: 'first', successStoryAction: 'You remembered what happened first.',
      spokenSuccess: 'Yes. That happened first. Now back to the story.', transitionTarget: 'reading-3',
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
  for (const scene of scenes) scene.interactionBeatIds = beats.filter((beat) => beat.visualSceneId === scene.sceneId).map((beat) => beat.beatId);
  return { version: 2, contentRevision: 4, chapterId: chapter.id, visualBible: bible, scenes, beats };
}

function stageEventCount(chapter: Chapter): number {
  const average = chapter.pages.reduce((sum, page) => sum + page.text.split(/\s+/).length, 0) / chapter.pages.length;
  return average <= 7 ? 2 : average <= 12 ? 3 : 4;
}

function shortEventCaption(text: string): string {
  const first = text.split(/(?<=[.!?])\s+/)[0]?.trim() ?? text.trim();
  const words = first.split(/\s+/).slice(0, 10).join(' ');
  return /[.!?]$/.test(words) ? words : `${words}.`;
}

export function resolveStoryInteractionManifest(chapter: Chapter): StoryInteractionManifest {
  if (typeof localStorage !== 'undefined') {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_PREFIX + chapter.id) ?? 'null') as StoryInteractionManifest | null;
      if (cached?.version === 2 && cached.contentRevision === 4 && cached.chapterId === chapter.id) return cached;
    } catch { /* regenerate a malformed local record */ }
  }
  const manifest = buildStoryInteractionManifest(chapter);
  if (typeof localStorage !== 'undefined') {
    try { localStorage.setItem(CACHE_PREFIX + chapter.id, JSON.stringify(manifest)); } catch { /* best effort */ }
  }
  return manifest;
}
