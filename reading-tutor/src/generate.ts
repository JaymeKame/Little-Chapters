/**
 * The chapter generator.
 *
 * Does NOT generate free-form. At stage 1 the vocabulary is about fifty words,
 * and a model inventing from nothing will drift and fail validation repeatedly.
 * Generation runs against a fixed skeleton: the beats are fixed, the nouns vary.
 *
 * The LLM client is injectable so the whole pipeline can be run and tested
 * offline without an API key.
 */

import { getStage, paletteForStage, allowedWordsForStage, STAGES } from '../content/stages';
import { validateAll, type CastContext, type StoryDraft, type Violation } from './validators';
import type { Skeleton } from './skeletons';
import {
  assignSlots, renderBeats, unresolvedSlots, type SlotAssignment,
} from './slots';

export interface LlmClient {
  /** Returns raw JSON text matching StoryDraft. */
  complete(prompt: string, attempt: number): Promise<string>;
}

export interface GenerateRequest {
  stage: number;
  cast: CastContext;
  /** Three things the child loves, from signup. */
  interests: string[];
  /** One-line summary of the story so far. Empty on the first chapter. */
  storySoFar: string;
  /** Words the child stumbled on recently. 2-3 get woven back in. */
  recentlyMissedWords: string[];
  skeleton: Skeleton;
  /**
   * The nouns for this chapter's blanks. Chosen by the caller from the stage
   * palette so they are legal by construction. Omit and they are chosen here.
   */
  slots?: SlotAssignment;
  /** Nouns used in recent chapters, avoided when there is enough choice. */
  recentNouns?: string[];
}

export interface GenerateResult {
  ok: boolean;
  draft?: StoryDraft;
  attempts: number;
  /** Every violation from every failed attempt, for the log. */
  rejectionLog: Array<{ attempt: number; violations: Violation[] }>;
  /** The nouns used. Persist these as recentNouns for tomorrow. */
  slots?: SlotAssignment;
}

const MAX_ATTEMPTS = 4;

/** Every sight word legal at this stage — stages 1..id, deduped. */
function cumulativeSightWords(id: number): string[] {
  const out = new Set<string>();
  for (const s of STAGES) {
    if (s.id > id) break;
    for (const w of s.sight_words_introduced) out.add(w.toLowerCase());
  }
  return [...out];
}

export function buildPrompt(
  req: GenerateRequest,
  previous?: Violation[],
  slots?: SlotAssignment,
): string {
  const stage = getStage(req.stage);
  const palette = paletteForStage(req.stage);
  const { min, max } = stage.sentence_length;

  const assignment = slots ?? req.slots ?? assignSlots(req.skeleton.beats, req.stage, {
    avoid: req.recentNouns,
  });
  const filled = renderBeats(req.skeleton.beats, assignment, {
    childName: req.cast.childName,
    petName: req.cast.petName,
  });

  const leftover = unresolvedSlots(filled);
  if (leftover.length) {
    throw new Error(
      `Skeleton "${req.skeleton.id}" has unfilled slots: ${leftover.join(', ')}. ` +
      `Every blank must be filled before the model is called.`,
    );
  }

  const missed = req.recentlyMissedWords
    .filter((w) => allowedWordsForStage(req.stage).has(w))
    .slice(0, 3);

  const parts: string[] = [];

  parts.push(
    `Write one chapter of an ongoing bedtime story for a child learning to read.`,
    ``,
    `THE CHILD`,
    `Name: ${req.cast.childName}`,
    req.cast.petName ? `Pet: ${req.cast.petName}` : `No pet.`,
    `Loves: ${req.interests.join(', ')}`,
    ``,
    `STORY SO FAR`,
    req.storySoFar || `This is the first chapter. Start fresh.`,
    ``,
    `THE CHAPTER - one sentence per beat, in this order`,
    ...filled.map((b, i) => `${i + 1}. ${b}`),
    ``,
    `The nouns above are already chosen. Use those exact words. Do not swap them`,
    `for synonyms, do not add other things to the scene. Your job is the phrasing.`,
    ``,
    `THE ENDING IS THE POINT`,
    req.skeleton.cliffhangerNote,
    `Stop mid-situation. Do not resolve anything. The last sentence must make`,
    `the child want tomorrow's chapter. This is the hardest constraint and the`,
    `entire reason the product works.`,
    ``,
    `VOCABULARY - absolute`,
    `Use ONLY these words, plus "${req.cast.childName}"${req.cast.petName ? ` and "${req.cast.petName}"` : ''}.`,
    `Any other word will be rejected.`,
    ``,
    `Nouns: ${palette.nouns.join(' ')}`,
    ``,
    `Verbs: ${palette.verbs.join(' ')}`,
    ``,
    `Describing words: ${palette.adjectives.join(' ')}`,
    ``,
    // CUMULATIVE, not this stage's new words: the phonics validator accepts
    // every sight word from stage 1 up, so listing only the newest ones hides
    // "a", "and", "the" from a stage-2 writer — over-constraining the model
    // against the rules it is actually graded on, and paying for the retries.
    `Joining words you may also use: ${cumulativeSightWords(stage.id).join(' ')}`,
    ``,
    `RULES`,
    `- ${req.skeleton.beats.length} sentences, ${min}-${max} words each.`,
    `- Cast is ${req.cast.childName}${req.cast.petName ? `, ${req.cast.petName}` : ''}, and ONE animal or object. No other people at all.`,
    `- No violence, peril, romance, religion, politics, or branded characters.`,
    `- Nothing frightening. Mild suspense only.`,
  );

  if (missed.length) {
    parts.push(
      `- Work these words in naturally, in new situations: ${missed.join(', ')}`,
    );
  }

  parts.push(
    ``,
    `OUTPUT - JSON only, no other text`,
    `{"sentences": [...], "imagePrompt": "...", "summaryLine": "..."}`,
    `imagePrompt: one line describing the final scene for an illustrator.`,
    `summaryLine: one line recording what happened, for tomorrow's context.`,
  );

  if (previous?.length) {
    const words = [...new Set(previous.map((v) => v.word).filter(Boolean))];
    parts.push(
      ``,
      `YOUR LAST ATTEMPT WAS REJECTED`,
      ...previous.slice(0, 10).map((v) => `- ${v.detail}`),
      words.length ? `Do not use: ${words.join(', ')}` : ``,
      `Rewrite completely. Keep the beats and the cliffhanger.`,
    );
  }

  return parts.filter((p) => p !== undefined).join('\n');
}

function parseDraft(raw: string): StoryDraft | null {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?/, '').replace(/```$/, '');
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.sentences)) return null;
    return {
      sentences: parsed.sentences.map(String),
      imagePrompt: String(parsed.imagePrompt ?? ''),
      summaryLine: String(parsed.summaryLine ?? ''),
    };
  } catch {
    return null;
  }
}

export async function generateChapter(
  req: GenerateRequest,
  llm: LlmClient,
  maxAttempts = MAX_ATTEMPTS,
): Promise<GenerateResult> {
  const rejectionLog: GenerateResult['rejectionLog'] = [];
  let previous: Violation[] | undefined;

  // Chosen once, then held across retries. If a chapter is rejected it is the
  // phrasing that failed, not the nouns - those came from the palette and were
  // legal by construction. Re-rolling them would hide the real problem.
  const slots = req.slots ?? assignSlots(req.skeleton.beats, req.stage, {
    avoid: req.recentNouns,
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const raw = await llm.complete(buildPrompt(req, previous, slots), attempt);
    const draft = parseDraft(raw);

    if (!draft) {
      const v = [{ rule: 'output/unparseable', detail: 'response was not valid JSON' }];
      rejectionLog.push({ attempt, violations: v });
      previous = v;
      continue;
    }

    const result = validateAll(draft, req.stage, req.cast);
    if (result.ok) {
      return { ok: true, draft, attempts: attempt, rejectionLog, slots };
    }

    rejectionLog.push({ attempt, violations: result.violations });
    previous = result.violations;
  }

  // Exhausted. The caller should fall back to a previously validated chapter
  // rather than showing the child nothing - a repeat is a good night, a blank
  // screen is a cancelled subscription.
  return { ok: false, attempts: maxAttempts, rejectionLog, slots };
}
