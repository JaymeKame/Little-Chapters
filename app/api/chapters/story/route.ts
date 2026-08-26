import { NextRequest, NextResponse } from 'next/server';
import { generateChapter, type LlmClient } from '@/reading-tutor/src/generate';
import { pickSkeleton, SKELETONS } from '@/reading-tutor/src/skeletons';
import { assignSlots } from '@/reading-tutor/src/slots';
import { requireReadingUser } from '@/lib/route-auth';
import { hasActiveSubscription } from '@/lib/entitlement-server';
import { type ChildProfile } from '@/lib/profile';
import { adminDb } from '@/lib/firebase-admin';
import { adaptTutorDraft, type Chapter } from '@/lib/chapters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* Same in-memory brake as the speech-token route: each generation is a paid
 * OpenAI call, so an unauthenticated open loop must not be able to burn spend.
 * Legit use is ≤1/child/day (the client caches per chapter id).             */
const GENERATIONS_PER_HOUR = 10;
const WINDOW_MS = 60 * 60 * 1000;
const grants = new Map<string, { windowStart: number; count: number }>();

function storyRef(chapterId: string) {
  return adminDb().collection('dailyChapters').doc(Buffer.from(chapterId).toString('base64url'));
}

const STORY_COMPANION_NAMES = ['Pip','Nori','Tavi','Bram','Kiko','Sula','Ollie','Zia'];
function companionFor(chapterId: string): string {
  let hash = 0; for (const char of chapterId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return STORY_COMPANION_NAMES[hash % STORY_COMPANION_NAMES.length];
}

export async function GET(request: NextRequest) {
  const auth = await requireReadingUser(request); if (!auth.ok) return auth.response;
  const chapterId = request.nextUrl.searchParams.get('chapterId');
  if (!chapterId || chapterId.length > 220) return NextResponse.json({ error: 'INVALID_CHAPTER_ID' }, { status: 400 });
  const stored = await storyRef(chapterId).get();
  if (!stored.exists || stored.data()?.ownerUid !== auth.uid) return NextResponse.json({ error: 'CHAPTER_NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ chapter: stored.data()?.chapter as Chapter, cache: 'hit' });
}

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
      chapterId?: string;
      profile?: ChildProfile;
      stage?: number;
      skeletonId?: string;
      recentlyMissedWords?: string[];
      storySoFar?: string;
    };
    const profile = body.profile;
    if (!profile?.childName || !Array.isArray(profile.interests) || !body.chapterId || body.chapterId.length > 220) {
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
    const companionName = companionFor(body.chapterId);
    const result = await generateChapter({
      stage,
      cast: { childName: profile.childName, petName: companionName },
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
    const adapted = adaptTutorDraft(profile, result.draft, skeleton, slots, stage);
    if (!adapted) return NextResponse.json({ error: 'Story generation failed' }, { status: 503 });
    const chapter = { ...adapted, character: profile.childName, companion: companionName };
    const payload = { draft: result.draft, skeleton, slots, chapter };
    await storyRef(body.chapterId).set({ chapter, ownerUid: auth.uid, generatedAt: new Date().toISOString() });
    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    console.error('Tutor story generation failed:', error);
    return NextResponse.json({ error: 'Story generation failed' }, { status: 503 });
  }
}
