import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminCredentialsConfigured, adminDb } from '@/lib/firebase-admin';
import { AVATARS, INTERESTS, type ChildProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function registeredUid(request: NextRequest): Promise<string | NextResponse> {
  if (!adminCredentialsConfigured()) return NextResponse.json({ error: 'ADMIN_NOT_CONFIGURED' }, { status: 503 });
  const header = request.headers.get('authorization') ?? '';
  try {
    const decoded = await adminAuth().verifyIdToken(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (decoded.firebase?.sign_in_provider === 'anonymous') throw new Error('anonymous');
    return decoded.uid;
  } catch {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  }
}

function normalize(raw: unknown): ChildProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<ChildProfile>;
  if (!p.childId || !p.childName?.trim() || !Array.isArray(p.interests)) return null;
  return {
    childId: p.childId.slice(0, 100),
    childName: p.childName.trim().slice(0, 40),
    age: Math.min(12, Math.max(3, Math.round(Number(p.age) || 6))),
    interests: p.interests.filter((id): id is ChildProfile['interests'][number] => INTERESTS.some((x) => x.id === id)).slice(0, 3),
    avatar: AVATARS.some((x) => x.id === p.avatar) ? p.avatar : undefined,
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
  };
}

export async function GET(request: NextRequest) {
  const uid = await registeredUid(request);
  if (typeof uid !== 'string') return uid;
  const snap = await adminDb().collection('parents').doc(uid).collection('children').doc('primary').get();
  return NextResponse.json({ profile: snap.exists ? normalize(snap.data()) : null });
}

export async function POST(request: NextRequest) {
  const uid = await registeredUid(request);
  if (typeof uid !== 'string') return uid;
  const profile = normalize(((await request.json().catch(() => null)) as { profile?: unknown } | null)?.profile);
  if (!profile) return NextResponse.json({ error: 'INVALID_PROFILE' }, { status: 400 });
  const ref = adminDb().collection('parents').doc(uid).collection('children').doc('primary');
  const existing = await ref.get();
  if (existing.exists && existing.data()?.childId !== profile.childId) {
    return NextResponse.json({ error: 'PROFILE_ALREADY_EXISTS' }, { status: 409 });
  }
  await ref.set({ ...profile, updatedAt: new Date().toISOString() }, { merge: true });
  return NextResponse.json({ ok: true, profile });
}
