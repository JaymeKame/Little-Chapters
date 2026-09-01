/* Stage-aware child-facing prose realizer.
 *
 * Why this file exists
 * --------------------
 * The story generator asks OpenAI to author a complete StoryBlueprint AND
 * to write the child-facing prose that satisfies a very narrow phonics
 * contract (e.g. Stage 1 has only 53 legal words, 6 verbs, 11 nouns, 3
 * adjectives, and requires every sentence to be exactly 5–6 tokens). In
 * live testing three consecutive Stage-1 attempts all failed literacy
 * validation — the model reliably drifts even when the contract is in
 * the prompt.
 *
 * The reading-tutor validator comment itself is explicit: validators are a
 * BACKSTOP, not the mechanism, and frequent validator failures mean
 * generation mechanics should be fixed rather than leaning harder on
 * rejection.
 *
 * So the model owns story SEMANTICS; this module owns child-facing PROSE.
 * The blueprint's premise/problem/beats/state/goal/resolution/climax and
 * both authored consequence semantics are unchanged. Only the sentences a
 * child actually reads are replaced with stage-legal frames derived from
 * the beat's own action shape.
 *
 * What is stage-1-safe by construction
 * -------------------------------------
 * - every sentence is emitted from a frame whose token count is
 *   pre-computed to fit the stage's sentence_length window;
 * - every content word is drawn from allowedWordsForStage(stage) or is
 *   an approved proper noun (childName / companionName);
 * - preview-word budget is tracked story-wide (default: zero at Stage 1
 *   so `phonics/too-many-preview-words` is structurally impossible);
 * - no capitalised token appears mid-sentence other than the child and
 *   companion names (validator's content/unknown-proper-noun rule);
 * - Prediction captions match the required `<Name> can <verb> <object>.`
 *   shape validated by predictionCaptionIssues.
 *
 * What this module deliberately does NOT do
 * -----------------------------------------
 * It does not rewrite the story's semantics. Blueprint fields internal to
 * the plan (summary, cause, visibleChange, emotionalPurpose, state,
 * resolution, climax, entityContinuity, visualContinuity, finalEmotionalBeat)
 * remain the model's — the child never reads them, downstream systems
 * (visuals, session composer, tests) do. */

import { allowedWordsForStage, getStage } from '../reading-tutor/content/stages';
import type { ChapterPage } from './chapters';
import type { StoryBlueprint, StoryBlueprintBeat, StoryLiteracyContract } from './story-blueprint';

interface StagePalette {
  nouns: string[];
  verbs: string[];
  adjectives: string[];
}

/** The stage's own generator_palette narrowed to the current allowed set —
 *  a paranoid check: the JSON should already agree, but a mismatch here would
 *  silently emit a preview or blocked word. */
function stagePalette(stage: number): StagePalette {
  const s = getStage(stage);
  const allowed = allowedWordsForStage(stage);
  return {
    nouns: s.generator_palette.nouns.filter((w) => allowed.has(w)),
    verbs: s.generator_palette.verbs.filter((w) => allowed.has(w)),
    adjectives: s.generator_palette.adjectives.filter((w) => allowed.has(w)),
  };
}

/** Deterministic per-blueprint pseudo-random pick: same blueprint always
 *  realizes to the same prose, so repeated GETs of the same chapter (or
 *  cached-generated reads) do not shuffle the story. */
function stableIndex(seed: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % Math.max(1, mod);
}

/** Blueprint objects often name things Stage 1 can't spell ("bag", "door",
 *  "path"). Map to the semantically-closest legal noun; when none matches,
 *  pick a stable default from the palette. Callers use the mapped word only
 *  in the child-facing sentence — the blueprint's own object list stays
 *  intact for image generation and internal semantics. */
const SEMANTIC_NOUN_MAP: Array<[RegExp, (palette: StagePalette) => string | null]> = [
  [/(bag|sack|pack|pouch|purse|basket|tin|can|jar|box)/i, (p) => p.nouns.find((w) => w === 'tin' || w === 'pan') ?? null],
  [/(map|chart|note|paper|book|letter|list)/i, (p) => p.nouns.find((w) => w === 'map') ?? null],
  [/(pad|cushion|mat|rug|blanket|bed)/i, (p) => p.nouns.find((w) => w === 'mat' || w === 'pad') ?? null],
  [/(hole|pit|well|hollow|nest|burrow)/i, (p) => p.nouns.find((w) => w === 'pit') ?? null],
  [/(pin|needle|key|latch|clip)/i, (p) => p.nouns.find((w) => w === 'pin') ?? null],
  [/(pan|dish|plate|bowl|cup|pot|kettle)/i, (p) => p.nouns.find((w) => w === 'pan') ?? null],
  [/(fan|wind|breeze|leaf|wing)/i, (p) => p.nouns.find((w) => w === 'fan') ?? null],
  [/(fin|tail|wing|paw|beak|nose)/i, (p) => p.nouns.find((w) => w === 'fin') ?? null],
  [/(tip|edge|end|top|point|corner)/i, (p) => p.nouns.find((w) => w === 'tip') ?? null],
  [/(nap|rest|sleep|dream)/i, (p) => p.nouns.find((w) => w === 'nap') ?? null],
];

function mapObjectToStageNoun(word: string | undefined, palette: StagePalette, fallbackSeed: string): string {
  const fallback = palette.nouns[stableIndex(`fallback:${fallbackSeed}`, palette.nouns.length)] ?? 'map';
  if (!word || palette.nouns.length === 0) return fallback;
  const lowered = word.toLowerCase();
  if (palette.nouns.includes(lowered)) return lowered;
  for (const [pattern, resolve] of SEMANTIC_NOUN_MAP) {
    if (pattern.test(lowered)) {
      const resolved = resolve(palette);
      if (resolved) return resolved;
    }
  }
  return fallback;
}

/** Same idea for verbs — the blueprint's beat.action may say "unlocks" or
 *  "carries"; map to the closest stage-legal verb. */
const SEMANTIC_VERB_MAP: Array<[RegExp, (palette: StagePalette) => string | null]> = [
  [/(tap|touch|knock|click|press)/i, (p) => (p.verbs.includes('tap') ? 'tap' : null)],
  [/(pat|stroke|pet|hug)/i, (p) => (p.verbs.includes('pat') ? 'pat' : null)],
  [/(sit|rest|wait|stop|pause)/i, (p) => (p.verbs.includes('sit') ? 'sit' : null)],
  [/(sat|rested|paused)/i, (p) => (p.verbs.includes('sat') ? 'sat' : null)],
  [/(fit|slide|slot|place|set)/i, (p) => (p.verbs.includes('fit') ? 'fit' : null)],
  [/(dip|reach|dive|plunge)/i, (p) => (p.verbs.includes('dip') ? 'dip' : null)],
];

function mapActionToStageVerb(action: string | undefined, palette: StagePalette, fallbackSeed: string, avoid?: string): string {
  const usable = palette.verbs.filter((v) => v !== avoid);
  const pool = usable.length ? usable : palette.verbs;
  const fallback = pool[stableIndex(`v:${fallbackSeed}`, pool.length)] ?? 'tap';
  if (!action) return fallback;
  const lowered = action.toLowerCase();
  for (const word of lowered.split(/\s+/)) {
    if (palette.verbs.includes(word) && word !== avoid) return word;
  }
  for (const [pattern, resolve] of SEMANTIC_VERB_MAP) {
    if (pattern.test(lowered)) {
      const resolved = resolve(palette);
      if (resolved && resolved !== avoid) return resolved;
    }
  }
  return fallback;
}

/** Prediction captions are additionally held to predictionCaptionIssues's
 *  isFiniteAction check (see FINITE_VERBS in story-blueprint.ts). Most
 *  higher-stage verbs (`sob`, `dug`, `got`, `beg`, `nod`, `tug`, ...) are
 *  not in FINITE_VERBS, so a caption that picks one fails the branch's
 *  grammar check even though it satisfies phonics. Restrict caption verbs
 *  to the Stage-1 core set that is BOTH in every stage's cumulative
 *  allowed vocabulary AND in FINITE_VERBS. This guarantees captions parse
 *  correctly at every stage and never becomes an accidental blocker. */
const CAPTION_SAFE_VERBS = ['tap', 'sit', 'sat', 'pat', 'fit', 'dip'] as const;
function mapActionToCaptionVerb(action: string | undefined, fallbackSeed: string, avoid?: string): string {
  const pool = CAPTION_SAFE_VERBS.filter((v) => v !== avoid);
  const usable = pool.length ? pool : (CAPTION_SAFE_VERBS as readonly string[]);
  const fallback = usable[stableIndex(`cv:${fallbackSeed}`, usable.length)] ?? 'tap';
  if (!action) return fallback;
  const lowered = action.toLowerCase();
  for (const word of lowered.split(/\s+/)) {
    if ((CAPTION_SAFE_VERBS as readonly string[]).includes(word) && word !== avoid) return word;
  }
  return fallback;
}

/** Structural sentence frames per stage. Each frame:
 *   - carries a fixed token count that lies inside the stage's sentence_length window;
 *   - names its slot dependencies so a caller can pick a frame that fits the beat's
 *     available material (a beat with no companion still gets a legal sentence).
 *
 *  Stage 1 frames are the interesting case (window 5-6). For higher stages the
 *  frames stay defensible while the palette gives real prose room, so the
 *  realizer only substitutes when the model's own prose failed literacy. */
type FrameSlots = { name: string; companion: string; noun1: string; noun2: string; adj: string; verb: string };
interface Frame { tokens: number; needs: (keyof FrameSlots)[]; render: (s: FrameSlots) => string }

function stageFrames(stage: number): Frame[] {
  if (stage <= 1) {
    // Every frame is exactly 5 or 6 tokens (Stage-1 window is 5–6).
    // Every content word is Stage-1-legal (see the 53-word allowed set:
    // 'a','am','an','and','as','at','dad','dam','did','dim','din','dip',
    // 'fad','fan','fat','fin','fit','i','if','in','is','it','mad','man',
    // 'map','mat','me','mid','my','nap','nip','on','pad','pan','pat','pin',
    // 'pip','pit','sad','said','sap','sat','see','sip','sit','tad','tan',
    // 'tap','the','tin','tip','to','we'). Any preview modal like "can" is
    // deliberately absent — Stage 1 emits zero preview words, so the
    // phonics/too-many-preview-words rule is structurally impossible.
    return [
      { tokens: 5, needs: ['name', 'noun1'],              render: (s) => `${s.name} sat on a ${s.noun1}.` },
      { tokens: 5, needs: ['name', 'verb', 'noun1'],      render: (s) => `${s.name} did ${s.verb} the ${s.noun1}.` },
      { tokens: 5, needs: ['companion', 'verb', 'noun1'], render: (s) => `${s.companion} did ${s.verb} the ${s.noun1}.` },
      { tokens: 6, needs: ['name', 'companion'],          render: (s) => `${s.name} and ${s.companion} sat on it.` },
      { tokens: 6, needs: ['name'],                       render: (s) => `${s.name} sat and did see it.` },
      { tokens: 5, needs: ['name', 'noun1'],              render: (s) => `${s.name} did see the ${s.noun1}.` },
      { tokens: 5, needs: ['name', 'companion', 'verb'],  render: (s) => `${s.name} and ${s.companion} did ${s.verb}.` },
      { tokens: 5, needs: ['noun1'],                      render: (s) => `We did see the ${s.noun1}.` },
      { tokens: 6, needs: ['adj', 'noun1'],               render: (s) => `A ${s.adj} ${s.noun1} sat on it.` },
      { tokens: 6, needs: ['name'],                       render: (s) => `${s.name} sat and did tap it.` },
    ];
  }
  // Higher stages: reuse the Stage-1-safe frames. Every stage in
  // content/stages.json has sentence_length.min = 5 and max >= 6, so a
  // 5–6 token Stage-1 frame is legal at every higher stage; and every
  // Stage-1 content token is in every higher stage's allowed set
  // (cumulative vocabulary). The realizer only substitutes at higher
  // stages when the model's own prose FAILED literacy — model prose
  // quality is preserved on the acceptance path in the generator.
  return stageFrames(1);
}

/** Prediction captions are held to a stricter grammar
 *  (see predictionCaptionIssues): `<Name> <finite action> <complement>.`
 *  `${Name} did ${verb} the ${noun}.` is exactly 5 tokens, starts with
 *  the protagonist, contains a finite verb (`tap`/`sit`/`sat`/`pat`/`fit`/
 *  `dip` are all in FINITE_VERBS), has a meaningful complement, ends
 *  with a period, AND stays entirely inside the Stage-1 allowed set
 *  (`did` is a Stage-1 sight word). "can" is NOT Stage-1 legal — it
 *  only appears at Stage 2 preview — so past-tense narration is the
 *  correct form here. */
function captionFor(name: string, verb: string, noun: string): string {
  return `${name} did ${verb} the ${noun}.`;
}

export interface RealizedProse {
  pages: ChapterPage[];
  optionAPage: ChapterPage;
  optionBPage: ChapterPage;
  captionA: string;
  captionB: string;
  finalEmotionalBeat: string;
  previewWordsUsed: string[];
  provenance: {
    pages: RealizationMapping[];
    optionA: RealizationMapping;
    optionB: RealizationMapping;
  };
}

export interface RealizationMapping {
  realizedFromBeatId: string;
  actionSource: string;
  objectSource: string | null;
  mappedAction: string;
  mappedObject: string;
}

/** Deterministic realization of the child-facing prose from a validated
 *  StoryBlueprint. Never throws. Never uses preview words beyond the
 *  contract's `maxPreviewWords`. Always emits `blueprint.pages.length` pages
 *  and both branch pages plus captions.
 *
 *  Preview budget: enforced by NEVER pulling from the preview list — the
 *  Stage-1 realizer stays entirely inside allowedWordsForStage(stage). Higher
 *  stages may allow preview but this pass uses zero, so
 *  `phonics/too-many-preview-words` is structurally impossible. */
export function realizeChildFacingProse(blueprint: StoryBlueprint, contract: StoryLiteracyContract, stage: number): RealizedProse {
  const palette = stagePalette(stage);
  const frames = stageFrames(stage);
  const name = blueprint.protagonist;
  const companion = blueprint.companion ?? contract.approvedProperNouns[1] ?? 'Pip';

  // Beat-to-page mapping: use main beats (excluding the two branch-consequence beats).
  const nonBranchBeats = blueprint.beats.filter((beat) => beat.role !== 'branch-consequence');
  const pageBeats: StoryBlueprintBeat[] = [];
  for (let i = 0; i < blueprint.pages.length; i += 1) {
    pageBeats.push(nonBranchBeats[Math.min(i, nonBranchBeats.length - 1)]);
  }

  const previewUsed = new Set<string>();
  const noteIfPreview = (word: string): void => {
    if (!palette.nouns.includes(word) && !palette.verbs.includes(word) && !palette.adjectives.includes(word)) {
      if (contract.previewVocabulary.includes(word)) previewUsed.add(word);
    }
  };

  const pickFrame = (seed: string, allow: Frame[]): Frame => {
    const usable = allow.length ? allow : frames;
    return usable[stableIndex(seed, usable.length)];
  };

  const rendered = new Set<string>();
  const pageMappings: RealizationMapping[] = [];
  const realizePage = (beat: StoryBlueprintBeat, index: number): ChapterPage => {
    const objectSource = beat.requiredVisibleObjects[0] ?? blueprint.entityContinuity[0] ?? null;
    const noun1 = mapObjectToStageNoun(objectSource ?? undefined, palette, `${blueprint.goalId}:p${index}:n1`);
    const noun2 = mapObjectToStageNoun(beat.requiredVisibleObjects[1] ?? blueprint.entityContinuity[1], palette, `${blueprint.goalId}:p${index}:n2`);
    const verb = mapActionToStageVerb(beat.action, palette, `${blueprint.goalId}:p${index}:v`);
    const adj = palette.adjectives[stableIndex(`${blueprint.goalId}:p${index}:a`, palette.adjectives.length)] ?? 'sad';
    const slots: FrameSlots = { name, companion, noun1, noun2: noun2 === noun1 ? (palette.nouns.find((n) => n !== noun1) ?? noun2) : noun2, adj, verb };
    // Prefer a frame the story hasn't rendered yet, but never invent one that
    // needs an unavailable slot; also avoid two adjacent duplicates.
    const preferred = frames.filter((frame) => !rendered.has(frame.render(slots)));
    const frame = pickFrame(`${blueprint.goalId}:p${index}`, preferred);
    const text = frame.render(slots);
    rendered.add(text);
    pageMappings.push({ realizedFromBeatId: beat.beatId, actionSource: beat.action, objectSource, mappedAction: verb, mappedObject: noun1 });
    // Report any accidental preview usage (structurally impossible on the
    // Stage-1 path, defensive on higher stages).
    text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).forEach(noteIfPreview);
    const focusWords = [noun1, verb].filter((word) => text.toLowerCase().includes(word));
    return { text, focusWords };
  };

  const pages = pageBeats.map((beat, index) => realizePage(beat, index));

  // Prediction branches: two distinct pre-authored consequences. Each gets a
  // page reflecting its consequence beat AND a caption of the required shape.
  const branchA = blueprint.prediction.optionA;
  const branchB = blueprint.prediction.optionB;
  const branchNounA = mapObjectToStageNoun(branchA.consequenceBeat.requiredVisibleObjects[0] ?? blueprint.entityContinuity[0], palette, `${blueprint.goalId}:brA:n`);
  const branchNounB = mapObjectToStageNoun(branchB.consequenceBeat.requiredVisibleObjects[0] ?? blueprint.entityContinuity[1] ?? blueprint.entityContinuity[0], palette, `${blueprint.goalId}:brB:n`);
  const branchVerbA = mapActionToCaptionVerb(branchA.consequenceBeat.action, `${blueprint.goalId}:brA:v`);
  const branchVerbB = mapActionToCaptionVerb(branchB.consequenceBeat.action, `${blueprint.goalId}:brB:v`, branchVerbA);
  // Guarantee the two branches produce visibly distinct child-facing prose;
  // duplicate-branches would fail validateStoryBlueprint even after realization.
  const nounB = branchNounB === branchNounA ? (palette.nouns.find((n) => n !== branchNounA) ?? branchNounB) : branchNounB;
  const captionA = captionFor(name, branchVerbA, branchNounA);
  const captionB = captionFor(name, branchVerbB, nounB);
  const optionAPage: ChapterPage = { text: `${name} did ${branchVerbA} the ${branchNounA}.`, focusWords: [branchNounA, branchVerbA] };
  const optionBPage: ChapterPage = { text: `${name} did ${branchVerbB} the ${nounB}.`, focusWords: [nounB, branchVerbB] };
  [captionA, captionB, optionAPage.text, optionBPage.text].forEach((t) => t.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).forEach(noteIfPreview));

  // finalEmotionalBeat is used as the parent-facing teaser (see
  // adaptTutorDraft) — parent-facing text is NOT literacy-validated, but we
  // keep it in the same voice so a child glancing at it isn't confused.
  const finalEmotionalBeat = `${name} did ${palette.verbs[0] ?? 'tap'} and sit.`;

  return {
    pages, optionAPage, optionBPage, captionA, captionB, finalEmotionalBeat, previewWordsUsed: [...previewUsed],
    provenance: {
      pages: pageMappings,
      optionA: { realizedFromBeatId: branchA.consequenceBeat.beatId, actionSource: branchA.consequenceBeat.action,
        objectSource: branchA.consequenceBeat.requiredVisibleObjects[0] ?? null, mappedAction: branchVerbA, mappedObject: branchNounA },
      optionB: { realizedFromBeatId: branchB.consequenceBeat.beatId, actionSource: branchB.consequenceBeat.action,
        objectSource: branchB.consequenceBeat.requiredVisibleObjects[0] ?? null, mappedAction: branchVerbB, mappedObject: nounB },
    },
  };
}

/** Apply realized prose to a blueprint, returning a new blueprint whose
 *  semantic plan is unchanged but whose child-facing text is stage-legal by
 *  construction. Never mutates the input blueprint. */
export function applyRealizedProse(blueprint: StoryBlueprint, prose: RealizedProse): StoryBlueprint {
  return {
    ...blueprint,
    pages: prose.pages,
    finalEmotionalBeat: prose.finalEmotionalBeat,
    prediction: {
      ...blueprint.prediction,
      optionA: { ...blueprint.prediction.optionA, caption: prose.captionA, page: prose.optionAPage },
      optionB: { ...blueprint.prediction.optionB, caption: prose.captionB, page: prose.optionBPage },
    },
  };
}
