/* POST /api/chapters/today — get-or-create the persisted chapter for
 * THIS child on THIS calendar day, keyed by uid + childId + day (see
 * lib/chapter-store-admin.ts for why this exists: the previous path,
 * lib/chapters.ts's localStorage-only TUTOR_CACHE_PREFIX cache, is per-
 * browser, so two devices signed into the same account could each
 * generate a different "today's chapter"). This is now the primary path
 * lib/chapters.ts's requestTutorChapter() calls for any signed-in,
 * non-anonymous-dev-stand-in caller; it falls back to the older
 * single-shot /api/chapters/story only when there is no uid/token to
 * persist under (local dev, or auth not yet settled).
 *
 * GENERATION / REPETITION AUDIT: entitlement is enforced exactly as
 * /api/chapters/story already does (hasActiveSubscription, server-side,
 * fails closed) — an unentitled caller is refused here with no generation
 * attempt and no persisted record, and the client falls back to the demo
 * arc. For an entitled caller, `source` on the returned record tells the
 * caller definitively whether OpenAI was actually reached this time
 * ('generated') or generation failed/was unconfigured and the demo arc
 * is standing in ('fallback') — see lib/story-generator.server.ts's
 * `generateStoryDraft`, which returns null (never throws) on either
 * OPENAI_API_KEY being unset or the model/validator failing, and always
 * logs server-side why, so a run of 'fallback' records is diagnosable
 * instead of just looking like the product got repetitive. */

import { NextRequest, NextResponse } from 'next/server';
import { requireReadingUser, adminUnconfiguredResponse } from '@/lib/route-auth';
import { loadOrCreateProgress } from '@/lib/progress-store-admin';
import { getOrCreateTodayChapter, isAuthoritativeChapterRecord, loadTodayChapter, type PersistedChapterRecord } from '@/lib/chapter-store-admin';
import { generateStoryDraft } from '@/lib/story-generator.server';
import { chapterIdForDay, isValidDay } from '@/lib/chapter-id';
import { type ChildProfile } from '@/lib/profile';
import { adaptTutorDraft, type Chapter } from '@/lib/chapters';
import { dailyChapterRef, resolveChapterEntitlement } from '@/lib/chapter-entitlement-server';
import { SKELETONS } from '@/reading-tutor/src/skeletons';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* Same in-memory brake as /api/chapters/story — get-or-create makes legit
 * use even lighter (≤1 real generation/child/day), but the route can still
 * be hit repeatedly by a misbehaving client. */
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

interface TodayRequestBody {
  profile?: ChildProfile;
  day?: string;
  ageDerivedStageEstimate?: number;
  skeletonId?: string;
  recentlyMissedWords?: string[];
  storySoFar?: string;
  recentStorySignatures?: string[];
}

async function tryGenerate(
  profile: ChildProfile,
  stage: number,
  body: TodayRequestBody,
  companionName: string,
  entitlementSource?: 'free' | 'subscription',
): Promise<Omit<PersistedChapterRecord, 'day' | 'chapterId' | 'stage' | 'createdAt'>> {
  const result = await generateStoryDraft({
    childName: profile.childName,
    companionName,
    interests: profile.interests,
    stage,
    skeletonId: body.skeletonId,
    recentlyMissedWords: body.recentlyMissedWords,
    storySoFar: body.storySoFar,
    childContext: profile.childContext,
    recentStorySignatures: body.recentStorySignatures,
  });
  if (!result) return { source: 'fallback' };
  return { source: 'generated', entitlementSource, draft: result.draft, blueprint: result.blueprint, skeletonId: result.skeleton.id, slots: result.slots };
}

const COMPANIONS = ['Pip', 'Nori', 'Tavi', 'Bram', 'Kiko', 'Sula', 'Ollie', 'Zia'];
function companionFor(chapterId: string): string {
  let hash = 0;
  for (const char of chapterId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COMPANIONS[hash % COMPANIONS.length];
}

export async function POST(request: NextRequest) {
  const unconfigured = adminUnconfiguredResponse();
  if (unconfigured) return unconfigured;

  const auth = await requireReadingUser(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as TodayRequestBody | null;
  const profile = body?.profile;
  if (!profile?.childId || !profile.childName || !Array.isArray(profile.interests)) {
    return NextResponse.json({ error: 'Invalid profile' }, { status: 400 });
  }
  if (!isValidDay(body?.day)) {
    return NextResponse.json({ error: 'Invalid day' }, { status: 400 });
  }
  const day = body!.day!;
  const ageEstimate = Math.min(10, Math.max(1, Math.round(body?.ageDerivedStageEstimate || 1)));

  // 'anonymous' is route-auth's local-dev-open marker (no admin credentials,
  // or SPEECH_ALLOW_UNAUTH=1) — no real account to partition Firestore
  // under, so this stays a pure pass-through generation call (same
  // permissiveness /api/chapters/story already has for this uid), never
  // persisted.
  if (auth.uid === 'anonymous') {
    const chapterId = chapterIdForDay(profile.interests[0], profile.childName, day);
    const generated = await tryGenerate(profile, ageEstimate, body!, companionFor(chapterId), 'free');
    const record: PersistedChapterRecord = {
      day,
      chapterId,
      stage: ageEstimate,
      createdAt: new Date().toISOString(),
      ...generated,
    };
    return NextResponse.json({ record, created: true });
  }

  if (overLimit(auth.uid)) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });

  try {
    // Persisted ChildProgress is authoritative for stage, not whatever the
    // client sent — "tomorrow's generation uses the child's latest
    // persisted reading stage" means the SERVER's copy, not a possibly
    // stale/tampered client value.
    const { progress } = await loadOrCreateProgress(auth.uid, profile.childId, ageEstimate);
    const stage = progress.stage;
    const chapterId = chapterIdForDay(profile.interests[0], profile.childName, day);
    const legacyRecord = await loadTodayChapter(auth.uid, profile.childId, day);
    const entitlementSource = isAuthoritativeChapterRecord(legacyRecord)
      ? legacyRecord?.entitlementSource ?? 'subscription' as const
      : await resolveChapterEntitlement(auth.uid, chapterId);
    if (!entitlementSource) return NextResponse.json({ error: 'CHAPTER_ENTITLEMENT_REQUIRED' }, { status: 402 });
    const companionName = companionFor(chapterId);

    const { record, created } = await getOrCreateTodayChapter(
      auth.uid,
      profile.childId,
      day,
      chapterId,
      stage,
      () => tryGenerate(profile, stage, body!, companionName, entitlementSource),
    );
    let chapter: Chapter | null = null;
    if (record.source === 'generated' && record.draft) {
      const skeleton = SKELETONS.find((candidate) => candidate.id === record.skeletonId);
      if (skeleton) {
        const adapted = adaptTutorDraft(profile, record.draft, skeleton, record.slots, record.stage, record.blueprint);
        if (adapted) {
          chapter = { ...adapted, id: chapterId, character: profile.childName, companion: companionName,
            provenance: { ...adapted.provenance, source: 'generated', entitlementSource: record.entitlementSource ?? entitlementSource } };
          await dailyChapterRef(chapterId).set({ chapter, ownerUid: auth.uid, entitlementSource: record.entitlementSource ?? entitlementSource, generatedAt: record.createdAt }, { merge: true });
        }
      }
    }
    return NextResponse.json({ record, chapter, created });
  } catch (error) {
    console.error('[chapters/today] get-or-create failed:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
