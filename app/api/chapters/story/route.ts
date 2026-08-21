import { NextRequest, NextResponse } from 'next/server';
import { generateChapter, type LlmClient } from '@/reading-tutor/src/generate';
import { pickSkeleton, SKELETONS } from '@/reading-tutor/src/skeletons';
import { assignSlots } from '@/reading-tutor/src/slots';
import { requireReadingUser } from '@/lib/route-auth';
import { hasActiveSubscription } from '@/lib/entitlement-server';
import { type ChildProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* Same in-memory brake as the speech-token route: each generation is a paid
 * OpenAI call, so an unauthenticated open loop must not be able to burn spend.
 * Legit use is ≤1/child/day (the client caches per chapter id).             */
const GENERATIONS_PER_HOUR = 10;
const WINDOW_MS = 60 * 60 * 1000;
const grants = new Map<string, { windowStart: number; count: number }>();

function overLimit(key: string): boolean {
  const now = Date.now();
  const g = grants.get(key);
  if (!g || now - g.windowStart > WINDOW_MS) {
    grants.set(key, { windowStart: now, count: 1 });
    return false;
  }
  g.count += 1;
  return g.count > GENERATIONS_PER_HOUR;
}

export async function POST(request: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ error: 'Story generation is not configured' }, { status: 503 });
  const auth = await requireReadingUser(request);
  if (!auth.ok) return auth.response;
  // Rate limit BEFORE the subscription check: the check costs a Firestore
  // read and up to two Stripe calls, so a client hammering this route must
  // be turned away by the in-memory counter, not by the expensive path.
  if (overLimit(auth.uid)) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  /* The paywall's load-bearing half. Freshly written chapters are the paid
   * product AND the only part of it that costs real money per request, so
   * this is where entitlement is actually ENFORCED — lib/entitlement.ts only
   * decides what the child sees. A demo visitor is refused here and the
   * client falls back to the built-in demo arc, which is exactly the
   * behaviour requestTutorChapter already documents for a failed generation:
   * free readers get the static story, subscribers get a stage-matched one.
   *
   * uid 'anonymous' is route-auth's local-dev-open marker (no admin
   * credentials, or SPEECH_ALLOW_UNAUTH=1) — left permitted so the tutor
   * path stays testable on a laptop without a live subscription. */
  if (auth.uid !== 'anonymous' && !(await hasActiveSubscription(auth.uid))) {
    return NextResponse.json({ error: 'SUBSCRIPTION_REQUIRED' }, { status: 402 });
  }
  try {
    const body = await request.json() as {
      profile?: ChildProfile;
      stage?: number;
      skeletonId?: string;
      recentlyMissedWords?: string[];
      storySoFar?: string;
    };
    const profile = body.profile;
    if (!profile?.childName || !Array.isArray(profile.interests)) {
      return NextResponse.json({ error: 'Invalid profile' }, { status: 400 });
    }
    const stage = Math.min(10, Math.max(1, Math.round(body.stage || 1)));
    // Both already-existing GenerateRequest fields — see
    // docs/ADAPTIVE_LOOP.md Phase 2. buildPrompt() itself re-filters
    // recentlyMissedWords through allowedWordsForStage(stage) before ever
    // using them, so a word that's since become stage-inappropriate can
    // never reach the model regardless of what the client sends.
    const recentlyMissedWords = Array.isArray(body.recentlyMissedWords)
      ? body.recentlyMissedWords.filter((w): w is string => typeof w === 'string').slice(0, 10)
      : [];
    const storySoFar = typeof body.storySoFar === 'string' ? body.storySoFar.slice(0, 500) : '';
    const skeleton = SKELETONS.find((candidate) => candidate.id === body.skeletonId) ?? pickSkeleton(stage, []);
    const slots = assignSlots(skeleton.beats, stage);
    const llm: LlmClient = {
      async complete(prompt: string) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: process.env.OPENAI_STORY_MODEL || 'gpt-4o-mini', temperature: 0.4, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
        });
        if (!response.ok) throw new Error(`story model returned ${response.status}`);
        const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        return json.choices?.[0]?.message?.content ?? '';
      },
    };
    const result = await generateChapter({
      stage,
      cast: { childName: profile.childName, petName: 'Momo' }, // Momo the reading pet, not the child twice
      interests: profile.interests,
      storySoFar,
      recentlyMissedWords,
      skeleton,
      slots,
    }, llm);
    if (!result.ok || !result.draft) {
      console.error('Tutor story generation exhausted retries', result.rejectionLog);
      return NextResponse.json({ error: 'Story generation failed' }, { status: 503 });
    }
    // slots go back too: the client's parent report must name the words the
    // story was actually generated with, not a fresh re-roll.
    return NextResponse.json({ draft: result.draft, skeleton, slots });
  } catch (error) {
    console.error('Tutor story generation failed:', error);
    return NextResponse.json({ error: 'Story generation failed' }, { status: 503 });
  }
}