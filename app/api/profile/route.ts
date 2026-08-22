/* GET/POST /api/profile — server mirror of the local-only ChildProfile
 * (lib/profile.ts) so a returning subscriber on a new browser/device, or
 * one who cleared site data, can be recognized instead of being routed
 * through Setup like a brand-new visitor. See lib/profile-store-admin.ts
 * for the storage rationale. Ownership is the VERIFIED caller uid from
 * requireReadingUser — no client-supplied uid is ever trusted. */

import { NextRequest, NextResponse } from 'next/server';
import { requireReadingUser, adminUnconfiguredResponse } from '@/lib/route-auth';
import { loadRemoteProfile, saveRemoteProfile } from '@/lib/profile-store-admin';
import { INTERESTS, AVATARS, type ChildProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const unconfigured = adminUnconfiguredResponse();
  if (unconfigured) return unconfigured;

  const auth = await requireReadingUser(request);
  if (!auth.ok) return auth.response;
  if (auth.uid === 'anonymous') return NextResponse.json({ profile: null });

  try {
    const profile = await loadRemoteProfile(auth.uid);
    return NextResponse.json({ profile });
  } catch (error) {
    console.error('[profile] load failed:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const unconfigured = adminUnconfiguredResponse();
  if (unconfigured) return unconfigured;

  const auth = await requireReadingUser(request);
  if (!auth.ok) return auth.response;
  if (auth.uid === 'anonymous') return NextResponse.json({ ok: true }); // dev-open stand-in — nothing to persist

  const body = (await request.json().catch(() => null)) as { profile?: ChildProfile } | null;
  const p = body?.profile;
  if (
    !p ||
    typeof p.childId !== 'string' || !p.childId ||
    typeof p.childName !== 'string' || !p.childName.trim() ||
    !Array.isArray(p.interests) || !p.interests.every((i) => INTERESTS.some((x) => x.id === i))
  ) {
    return NextResponse.json({ error: 'Invalid profile' }, { status: 400 });
  }
  const profile: ChildProfile = {
    childId: p.childId,
    childName: p.childName.slice(0, 40),
    age: typeof p.age === 'number' && Number.isFinite(p.age) ? Math.min(12, Math.max(3, Math.round(p.age))) : 6,
    interests: p.interests.slice(0, 3),
    avatar: AVATARS.some((a) => a.id === p.avatar) ? p.avatar : undefined,
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
  };

  try {
    await saveRemoteProfile(auth.uid, profile);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[profile] save failed:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
