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

export function isStoryGenerationConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/** Returns null on any failure (not configured, validator exhaustion, model
 *  error) — every caller's contract is "fall back to the demo arc", never
 *  throw. Failures are logged server-side (not swallowed silently) so a
 *  string of nulls is diagnosable instead of just looking like a
 *  repetitive product — see the GENERATION/REPETITION AUDIT note in
 *  app/api/chapters/today/route.ts. */
export async function generateStoryDraft(params: StoryGenerationParams): Promise<StoryGenerationResult | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
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
        model: process.env.OPENAI_STORY_MODEL || 'gpt-4o-mini', temperature: 0.35,
        response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) throw new Error(`story model returned ${response.status}`);
    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? '';
  };
  try {
    const basePrompt = blueprintGenerationPrompt({
      childName: params.childName, companionName: params.companionName ?? 'Momo', interests: params.interests,
      childContext: params.childContext, stage, targetWords: Object.values(slots), storySoFar,
      recentStorySignatures: (params.recentStorySignatures ?? []).filter((row): row is string => typeof row === 'string').slice(0, 5),
    });
    let rejection = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const raw = await complete(`${basePrompt}\n${rejection ? `Repair all of these previous validation failures: ${rejection}` : ''}`);
      let blueprint: StoryBlueprint;
      try { blueprint = JSON.parse(raw) as StoryBlueprint; } catch { rejection = 'invalid JSON'; continue; }
      const holistic = validateStoryBlueprint(blueprint);
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
      if (holistic.ok && literacy.ok) return { draft, skeleton, slots, blueprint };
      rejection = [...holistic.issues.map((issue) => `${issue.code}: ${issue.detail}`), ...literacy.violations.map((issue) => `${issue.rule}: ${issue.detail}`)].slice(0, 20).join('; ');
    }
    console.error('[story-generator] complete blueprint exhausted retries', rejection);
    return null;
  } catch (error) {
    console.error('[story-generator] generation failed:', error);
    return null;
  }
}
