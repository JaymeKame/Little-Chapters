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
import type { StoryDraft } from '../reading-tutor/src/validators';
import { validateAll } from '../reading-tutor/src/validators';
import type { InterestId } from './profile';
import { blueprintGenerationPrompt, validateStoryBlueprint, type StoryBlueprint } from './story-blueprint.ts';

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
  | 'retry-exhausted' | 'unknown';
export interface StoryGenerationAttemptDiagnostic {
  attempt: number; model: string; providerReached: boolean; httpStatus: number | null;
  result: 'provider-error' | 'empty-response' | 'invalid-json' | 'blueprint-validation' | 'literacy-validation' | 'accepted' | 'unknown';
  ruleCodes: string[];
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
      childContext: params.childContext, stage, targetWords: Object.values(slots), storySoFar,
      recentStorySignatures: (params.recentStorySignatures ?? []).filter((row): row is string => typeof row === 'string').slice(0, 5),
    });
    let rejection = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await complete(`${basePrompt}\n${rejection ? `Repair all of these previous validation failures: ${rejection}` : ''}`);
      const number = attempt + 1;
      if (response.status < 200 || response.status >= 300) {
        attempts.push({ attempt: number, model, providerReached: true, httpStatus: response.status, result: 'provider-error', ruleCodes: [] });
        continue;
      }
      const raw = response.content;
      if (!raw.trim()) { attempts.push({ attempt: number, model, providerReached: true, httpStatus: response.status, result: 'empty-response', ruleCodes: [] }); continue; }
      let blueprint: StoryBlueprint;
      try { blueprint = JSON.parse(raw) as StoryBlueprint; } catch { rejection = 'invalid JSON'; attempts.push({ attempt: number, model, providerReached: true, httpStatus: response.status, result: 'invalid-json', ruleCodes: [] }); continue; }
      let holistic: ReturnType<typeof validateStoryBlueprint>;
      try { holistic = validateStoryBlueprint(blueprint); }
      catch {
        rejection = 'invalid-blueprint-shape';
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
      attempts.push({ attempt: number, model, providerReached: true, httpStatus: response.status,
        result: holistic.ok ? 'literacy-validation' : 'blueprint-validation', ruleCodes: [...blueprintCodes, ...literacyCodes].slice(0, 20) });
      rejection = [...holistic.issues.map((issue) => `${issue.code}: ${issue.detail}`), ...literacy.violations.map((issue) => `${issue.rule}: ${issue.detail}`)].slice(0, 20).join('; ');
    }
    console.error('[story-generator] complete blueprint exhausted retries', rejection);
    const last = attempts.at(-1);
    const reason: StoryGenerationFailureReason = attempts.every((row) => row.result === 'provider-error')
      ? providerReason(last?.httpStatus ?? 0)
      : attempts.every((row) => row.result === 'blueprint-validation') ? 'blueprint-validation'
      : attempts.every((row) => row.result === 'literacy-validation') ? 'literacy-validation'
      : attempts.every((row) => row.result === 'invalid-json') ? 'invalid-json'
      : attempts.every((row) => row.result === 'empty-response') ? 'empty-response' : 'retry-exhausted';
    return { ok: false, reason, diagnostic: { model, attempts } };
  } catch (error) {
    console.error('[story-generator] generation failed:', error);
    attempts.push({ attempt: attempts.length + 1, model, providerReached: false, httpStatus: null, result: 'unknown', ruleCodes: [] });
    return { ok: false, reason: 'unknown', diagnostic: { model, attempts } };
  }
}

function providerReason(status: number): StoryGenerationFailureReason {
  if (status === 401 || status === 403) return 'provider-401';
  if (status === 429) return 'provider-429';
  if (status >= 500) return 'provider-5xx';
  return 'provider-4xx';
}
