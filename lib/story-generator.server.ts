/* SERVER-ONLY: the actual OpenAI story-generation call, factored out of
 * app/api/chapters/story/route.ts so app/api/chapters/today/route.ts (the
 * new persisted get-or-create path) can call the exact same generation
 * logic instead of re-implementing it — two independent copies of prompt
 * construction / model choice / retry behavior would silently drift.
 * Never imported from a 'use client' module — see lib/stripe.ts's identical
 * warning for why (this pulls in reading-tutor's generation pipeline and
 * reads OPENAI_API_KEY directly). */

import { pickSkeleton, SKELETONS, type Skeleton } from '../reading-tutor/src/skeletons';
import { assignSlots } from '../reading-tutor/src/slots';
import { allowedWordsForStage, getStage } from '../reading-tutor/content/stages';
import type { StoryDraft } from '../reading-tutor/src/validators';
import { validateAll } from '../reading-tutor/src/validators';
import type { InterestId } from './profile';
import { blueprintGenerationPrompt, normalizeStoryBlueprint, validateStoryBlueprint, type StoryBlueprint, type StoryLiteracyContract } from './story-blueprint.ts';
import { applyRealizedProse, realizeChildFacingProse } from './story-realizer';

export interface StoryGenerationParams {
  childName: string;
  companionName?: string;
  interests: InterestId[];
  stage: number;
  skeletonId?: string;
  recentlyMissedWords?: string[];
  storySoFar?: string;
  childContext?: string;
  recentStorySignatures?: string[];
}

export interface StoryGenerationResult {
  draft: StoryDraft;
  skeleton: Skeleton;
  slots: Record<string, string>;
  blueprint: StoryBlueprint;
}

export type StoryGenerationFailureReason =
  | 'not-configured' | 'provider-401' | 'provider-429' | 'provider-4xx' | 'provider-5xx'
  | 'empty-response' | 'invalid-json' | 'blueprint-validation' | 'literacy-validation'
  | 'realization-failed' | 'retry-exhausted' | 'unknown';
export interface StoryGenerationAttemptDiagnostic {
  attempt: number; model: string; providerReached: boolean; httpStatus: number | null;
  result: 'provider-error' | 'empty-response' | 'invalid-json' | 'blueprint-validation' | 'literacy-validation' | 'accepted' | 'accepted-realized' | 'realization-failed' | 'unknown';
  ruleCodes: string[];
  /** Set only when this attempt was accepted after realizer substitution —
   *  useful to distinguish "model wrote clean prose" from "model wrote a
   *  clean plan, system produced clean prose from it". Never contains
   *  prose, tokens, or provider output. */
  realized?: { previewWordsUsed: number };
}
export type StoryGenerationOutcome =
  | { ok: true; result: StoryGenerationResult; diagnostic: { model: string; attempts: StoryGenerationAttemptDiagnostic[] } }
  | { ok: false; reason: StoryGenerationFailureReason; diagnostic: { model: string; attempts: StoryGenerationAttemptDiagnostic[] } };

export function isStoryGenerationConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/** Never throws provider or validation failures across the route boundary.
 * Returns either the accepted result or a safe structured outcome containing
 * status/attempt/rule codes only — never prompts, child context, credentials,
 * or raw provider output. */
export async function generateStoryDraft(params: StoryGenerationParams): Promise<StoryGenerationOutcome> {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_STORY_MODEL || 'gpt-4o-mini';
  const attempts: StoryGenerationAttemptDiagnostic[] = [];
  if (!key) return { ok: false, reason: 'not-configured', diagnostic: { model, attempts } };
  const stage = Math.min(10, Math.max(1, Math.round(params.stage || 1)));
  // Both already-existing GenerateRequest fields — see docs/ADAPTIVE_LOOP.md
  // Phase 2. buildPrompt() itself re-filters recentlyMissedWords through
  // allowedWordsForStage(stage) before ever using them, so a word that's
  // since become stage-inappropriate can never reach the model regardless
  // of what's supplied here.
  const recentlyMissedWords = (params.recentlyMissedWords ?? []).filter((w): w is string => typeof w === 'string').slice(0, 10);
  const storySoFar = (params.storySoFar ?? '').slice(0, 500);
  const skeleton = SKELETONS.find((candidate) => candidate.id === params.skeletonId) ?? pickSkeleton(stage, []);
  const slots = assignSlots(skeleton.beats, stage);
  const literacyContract = storyLiteracyContract(stage, params.childName, params.companionName ?? 'Momo', Object.values(slots));
  const complete = async (prompt: string) => {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, temperature: 0.35,
        response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) return { status: response.status, content: '' };
    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return { status: response.status, content: json.choices?.[0]?.message?.content ?? '' };
  };
  try {
    const basePrompt = blueprintGenerationPrompt({
      childName: params.childName, companionName: params.companionName ?? 'Momo', interests: params.interests,
      childContext: params.childContext, stage, targetWords: literacyContract.targetWords, literacy: literacyContract, storySoFar,
      recentStorySignatures: (params.recentStorySignatures ?? []).filter((row): row is string => typeof row === 'string').slice(0, 5),
    });
    let rejection = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await complete(`${basePrompt}\n${rejection}`);
      const number = attempt + 1;
      if (response.status < 200 || response.status >= 300) {
        attempts.push({ attempt: number, model, providerReached: true, httpStatus: response.status, result: 'provider-error', ruleCodes: [] });
        continue;
      }
      const raw = response.content;
      if (!raw.trim()) { attempts.push({ attempt: number, model, providerReached: true, httpStatus: response.status, result: 'empty-response', ruleCodes: [] }); continue; }
      let blueprint: StoryBlueprint;
      try { blueprint = JSON.parse(raw) as StoryBlueprint; } catch { rejection = 'REPAIR: Return valid JSON matching the exact schema. Do not include markdown.'; attempts.push({ attempt: number, model, providerReached: true, httpStatus: response.status, result: 'invalid-json', ruleCodes: [] }); continue; }
      let holistic: ReturnType<typeof validateStoryBlueprint>;
      try { blueprint = normalizeStoryBlueprint(blueprint); holistic = validateStoryBlueprint(blueprint); }
      catch {
        rejection = 'REPAIR invalid-blueprint-shape: Return every required object and array in the exact schema.';
        attempts.push({ attempt: number, model, providerReached: true, httpStatus: response.status, result: 'blueprint-validation', ruleCodes: ['invalid-blueprint-shape'] });
        continue;
      }
      const draft: StoryDraft = {
        sentences: blueprint.pages.map((page) => page.text),
        imagePrompt: blueprint.beats.map((beat) => `${beat.summary}: ${beat.action}`).join(' | '),
        summaryLine: blueprint.finalEmotionalBeat,
      };
      // Branch prose is child-facing too, even though only one path is later
      // materialized. Validate both paths now; never defer safety/decodability
      // until the child clicks a Prediction option.
      const validationDraft: StoryDraft = {
        ...draft,
        sentences: [...draft.sentences, blueprint.prediction.optionA.page.text, blueprint.prediction.optionB.page.text,
          blueprint.prediction.optionA.caption, blueprint.prediction.optionB.caption],
        imagePrompt: `${draft.imagePrompt} | ${blueprint.prediction.optionA.visualDescription} | ${blueprint.prediction.optionB.visualDescription}`,
      };
      const literacy = validateAll(validationDraft, stage, { childName: params.childName, petName: params.companionName ?? 'Momo' });
      const blueprintCodes = [...new Set(holistic.issues.map((issue) => issue.code))];
      const literacyCodes = [...new Set(literacy.violations.map((issue) => issue.rule))];
      if (holistic.ok && literacy.ok) {
        attempts.push({ attempt: number, model, providerReached: true, httpStatus: response.status, result: 'accepted', ruleCodes: [] });
        return { ok: true, result: { draft, skeleton, slots, blueprint }, diagnostic: { model, attempts } };
      }
      // Blueprint is holistically sound but the model's own prose failed
      // literacy — this is the reliable-in-live-tests case at Stage 1. The
      // realizer replaces ONLY the child-facing text (pages, both branch
      // pages, both captions, and finalEmotionalBeat/teaser) with prose
      // built from stage-legal frames driven by the beat's semantics. The
      // blueprint's plan (premise/beats/state/goal/climax/resolution) is
      // untouched — visuals, session composer, and the Prediction contract
      // still read authoritative model semantics. If realization for some
      // reason still fails literacy (should be structurally impossible for
      // stages ≤ 1), the attempt is rejected as `realization-failed` and
      // the loop retries the model.
      if (holistic.ok) {
        try {
          const realized = realizeChildFacingProse(blueprint, literacyContract, stage);
          const realizedBlueprint = applyRealizedProse(blueprint, realized);
          const realizedDraft: StoryDraft = {
            sentences: realizedBlueprint.pages.map((page) => page.text),
            imagePrompt: draft.imagePrompt,
            summaryLine: realizedBlueprint.finalEmotionalBeat,
          };
          const realizedValidationDraft: StoryDraft = {
            ...realizedDraft,
            sentences: [...realizedDraft.sentences, realizedBlueprint.prediction.optionA.page.text, realizedBlueprint.prediction.optionB.page.text,
              realizedBlueprint.prediction.optionA.caption, realizedBlueprint.prediction.optionB.caption],
            imagePrompt: `${realizedDraft.imagePrompt} | ${realizedBlueprint.prediction.optionA.visualDescription} | ${realizedBlueprint.prediction.optionB.visualDescription}`,
          };
          const realizedHolistic = validateStoryBlueprint(realizedBlueprint);
          const realizedLiteracy = validateAll(realizedValidationDraft, stage, { childName: params.childName, petName: params.companionName ?? 'Momo' });
          if (realizedHolistic.ok && realizedLiteracy.ok) {
            attempts.push({ attempt: number, model, providerReached: true, httpStatus: response.status, result: 'accepted-realized', ruleCodes: [], realized: { previewWordsUsed: realized.previewWordsUsed.length } });
            return { ok: true, result: { draft: realizedDraft, skeleton, slots, blueprint: realizedBlueprint }, diagnostic: { model, attempts } };
          }
          const realizedCodes = [
            ...new Set(realizedHolistic.issues.map((issue) => issue.code)),
            ...new Set(realizedLiteracy.violations.map((issue) => issue.rule)),
          ];
          attempts.push({ attempt: number, model, providerReached: true, httpStatus: response.status, result: 'realization-failed', ruleCodes: realizedCodes.slice(0, 20) });
          rejection = targetedRepairInstructions([...blueprintCodes, ...literacyCodes], literacyContract, literacy.violations.map((issue) => issue.word).filter((word): word is string => Boolean(word)));
          continue;
        } catch (error) {
          attempts.push({ attempt: number, model, providerReached: true, httpStatus: response.status, result: 'realization-failed', ruleCodes: [error instanceof Error ? error.name : 'realizer-threw'] });
          rejection = targetedRepairInstructions([...blueprintCodes, ...literacyCodes], literacyContract, literacy.violations.map((issue) => issue.word).filter((word): word is string => Boolean(word)));
          continue;
        }
      }
      attempts.push({ attempt: number, model, providerReached: true, httpStatus: response.status,
        result: 'blueprint-validation', ruleCodes: [...blueprintCodes, ...literacyCodes].slice(0, 20) });
      rejection = targetedRepairInstructions([...blueprintCodes, ...literacyCodes], literacyContract, literacy.violations.map((issue) => issue.word).filter((word): word is string => Boolean(word)));
    }
    console.error('[story-generator] complete blueprint exhausted retries', rejection);
    const last = attempts.at(-1);
    const reason: StoryGenerationFailureReason = attempts.every((row) => row.result === 'provider-error')
      ? providerReason(last?.httpStatus ?? 0)
      : attempts.every((row) => row.result === 'blueprint-validation') ? 'blueprint-validation'
      : attempts.every((row) => row.result === 'literacy-validation') ? 'literacy-validation'
      : attempts.every((row) => row.result === 'realization-failed') ? 'realization-failed'
      : attempts.every((row) => row.result === 'invalid-json') ? 'invalid-json'
      : attempts.every((row) => row.result === 'empty-response') ? 'empty-response' : 'retry-exhausted';
    return { ok: false, reason, diagnostic: { model, attempts } };
  } catch (error) {
    console.error('[story-generator] generation failed:', error);
    attempts.push({ attempt: attempts.length + 1, model, providerReached: false, httpStatus: null, result: 'unknown', ruleCodes: [] });
    return { ok: false, reason: 'unknown', diagnostic: { model, attempts } };
  }
}

/** The validator's exact literacy boundary, made available to the model before
 * it writes prose. The current-stage list is finite (the largest V1 stage is
 * still small enough for one prompt) and is the validator's own source of
 * truth, not a separately maintained approximation. */
export function storyLiteracyContract(stage: number, childName: string, companionName: string, proposedTargets: string[]): StoryLiteracyContract {
  const current = [...allowedWordsForStage(stage)].sort();
  const next = stage < 10 ? [...allowedWordsForStage(stage + 1)].filter((word) => !allowedWordsForStage(stage).has(word)).sort() : [];
  const legalTargets = proposedTargets.map((word) => word.toLowerCase()).filter((word) => allowedWordsForStage(stage).has(word));
  const previewTargets = proposedTargets.map((word) => word.toLowerCase()).filter((word) => next.includes(word)).slice(0, 2);
  return {
    currentVocabulary: current,
    previewVocabulary: next,
    maxPreviewWords: 2,
    sentenceLength: getStage(stage).sentence_length,
    approvedProperNouns: [childName, companionName],
    targetWords: [...new Set([...legalTargets, ...previewTargets])],
    actionVocabulary: getStage(stage).generator_palette.verbs.filter((word) => allowedWordsForStage(stage).has(word)),
  };
}

export function targetedRepairInstructions(ruleCodes: string[], contract: StoryLiteracyContract, offendingWords: string[]): string {
  if (!ruleCodes.length) return '';
  const rules = new Set(ruleCodes);
  const lines = ['REPAIR ONLY THE FAILED CONTRACTS BELOW; return the complete corrected JSON:'];
  if (rules.has('phonics/not-decodable')) lines.push(`phonics/not-decodable: replace these illegal tokens (${[...new Set(offendingWords)].slice(0, 20).join(', ') || 'the rejected tokens'}) using CURRENT VOCABULARY only.`);
  if (rules.has('phonics/too-many-preview-words')) lines.push(`phonics/too-many-preview-words: use no more than ${contract.maxPreviewWords} distinct PREVIEW VOCABULARY words in the entire child-facing story.`);
  if (rules.has('phonics/sentence-length')) lines.push(`phonics/sentence-length: every child-facing sentence must have exactly ${contract.sentenceLength.min}-${contract.sentenceLength.max} words.`);
  if (rules.has('content/unknown-proper-noun')) lines.push(`content/unknown-proper-noun: the only capitalized names allowed are ${contract.approvedProperNouns.join(' and ')}; make all locations generic and lowercase.`);
  if (rules.has('malformed-prediction')) lines.push(`malformed-prediction: each caption must be "${contract.approvedProperNouns[0]} can <legal action> <meaningful complement>."; choose different actions from ${contract.actionVocabulary.join(', ')}.`);
  if (rules.has('unresolved-ending') || rules.has('goal-discontinuity')) lines.push('goal contract: keep unresolvedGoal="goal-1" until the declared resolution beat; then set it to "", set goalResolutionStatus="resolved", and point goalResolutionBeatId to that beat.');
  if (rules.has('unexplained-entity')) lines.push('unexplained-entity: declare each newly visible object in discoveredObjects on its first beat; do not copy inconsistent stateBefore snapshots because inherited state is computed by code.');
  for (const code of rules) if (!lines.some((line) => line.startsWith(code)) && !['goal-discontinuity'].includes(code)) lines.push(`${code}: repair this exact structural contract using the schema instructions.`);
  return lines.join('\n');
}

function providerReason(status: number): StoryGenerationFailureReason {
  if (status === 401 || status === 403) return 'provider-401';
  if (status === 429) return 'provider-429';
  if (status >= 500) return 'provider-5xx';
  return 'provider-4xx';
}
