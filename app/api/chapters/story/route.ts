import { NextRequest, NextResponse } from 'next/server';
import { requireReadingUser } from '@/lib/route-auth';
import { type ChildProfile } from '@/lib/profile';
import { adaptTutorDraft, type Chapter } from '@/lib/chapters';
import { dailyChapterRef, ownedDailyChapter, resolveChapterEntitlement } from '@/lib/chapter-entitlement-server';
import { generateStoryDraft, isStoryGenerationConfigured } from '@/lib/story-generator.server';
import { adminCredentialsConfigured } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* Same in-memory brake as the speech-token route: each generation is a paid
 * OpenAI call, so an unauthenticated open loop must not be able to burn spend.
 * Legit use is ≤1/child/day (the client caches per chapter id).             */
const GENERATIONS_PER_HOUR = 10;
const WINDOW_MS = 60 * 60 * 1000;
const grants = new Map<string, { windowStart: number; count: number }>();

const STORY_COMPANION_NAMES = ['Pip','Nori','Tavi','Bram','Kiko','Sula','Ollie','Zia'];
function companionFor(chapterId: string): string {
  let hash = 0; for (const char of chapterId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return STORY_COMPANION_NAMES[hash % STORY_COMPANION_NAMES.length];
}

export async function GET(request: NextRequest) {
  const auth = await requireReadingUser(request); if (!auth.ok) return auth.response;
  const chapterId = request.nextUrl.searchParams.get('chapterId');
  if (!chapterId || chapterId.length > 220) return NextResponse.json({ error: 'INVALID_CHAPTER_ID' }, { status: 400 });
  if (!adminCredentialsConfigured()) return NextResponse.json({ error: 'CHAPTER_NOT_FOUND' }, { status: 404 });
  const stored = await ownedDailyChapter(auth.uid, chapterId);
  if (!stored) return NextResponse.json({ error: 'CHAPTER_NOT_FOUND' }, { status: 404 });
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
  const auth = await requireReadingUser(request);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json() as {
      chapterId?: string;
      profile?: ChildProfile;
      stage?: number;
      skeletonId?: string;
      recentlyMissedWords?: string[];
      storySoFar?: string;
      recentStorySignatures?: string[];
    };
    const profile = body.profile;
    if (!profile?.childName || !Array.isArray(profile.interests) || !body.chapterId || body.chapterId.length > 220) {
      return NextResponse.json({ error: 'Invalid profile' }, { status: 400 });
    }
    if (!adminCredentialsConfigured() && auth.uid === 'anonymous') {
      return NextResponse.json({ error: 'Story generation persistence is not configured' }, { status: 503 });
    }
    const existing = await ownedDailyChapter(auth.uid, body.chapterId);
    if (existing) return NextResponse.json({ chapter: existing.data()?.chapter as Chapter, cache: 'hit' });
    const entitlementSource = await resolveChapterEntitlement(auth.uid, body.chapterId);
    if (!entitlementSource) return NextResponse.json({ error: 'CHAPTER_ENTITLEMENT_REQUIRED' }, { status: 402 });
    if (!isStoryGenerationConfigured()) return NextResponse.json({ error: 'Story generation is not configured' }, { status: 503 });
    if (overLimit(auth.uid)) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
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
    const companionName = companionFor(body.chapterId);
    const result = await generateStoryDraft({
      childName: profile.childName,
      companionName,
      stage,
      interests: profile.interests,
      storySoFar,
      recentlyMissedWords,
      skeletonId: body.skeletonId,
      childContext: profile.childContext,
      recentStorySignatures: Array.isArray(body.recentStorySignatures) ? body.recentStorySignatures.slice(0, 5) : [],
    });
    if (!result) return NextResponse.json({ error: 'Story generation failed' }, { status: 503 });
    const { draft, skeleton, slots, blueprint } = result;
    // slots go back too: the client's parent report must name the words the
    // story was actually generated with, not a fresh re-roll.
    const adapted = adaptTutorDraft(profile, draft, skeleton, slots, stage, blueprint);
    if (!adapted) return NextResponse.json({ error: 'Story generation failed' }, { status: 503 });
    const chapter = { ...adapted, id: body.chapterId, character: profile.childName, companion: companionName,
      provenance: { ...adapted.provenance, entitlementSource } };
    const payload = { draft, skeleton, slots, blueprint, chapter };
    await dailyChapterRef(body.chapterId).set({ chapter, ownerUid: auth.uid, entitlementSource, generatedAt: new Date().toISOString() });
    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    console.error('Tutor story generation failed:', error);
    return NextResponse.json({ error: 'Story generation failed' }, { status: 503 });
  }
}
