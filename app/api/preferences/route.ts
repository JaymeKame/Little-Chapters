import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminCredentialsConfigured, adminDb } from '@/lib/firebase-admin';
import type { ConsumerPreferences } from '@/lib/preference-values';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function uidFor(request: NextRequest): Promise<string | NextResponse> {
  if (!adminCredentialsConfigured()) return NextResponse.json({ error: 'ADMIN_NOT_CONFIGURED' }, { status: 503 });
  try {
    const header = request.headers.get('authorization') ?? '';
    const decoded = await adminAuth().verifyIdToken(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (decoded.firebase?.sign_in_provider === 'anonymous') throw new Error('anonymous');
    return decoded.uid;
  } catch { return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 }); }
}

function normalize(raw: unknown): ConsumerPreferences | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<ConsumerPreferences>;
  if (!['too-easy', 'about-right', 'too-hard'].includes(p.difficultyObservation ?? '')) return null;
  if (!['off', 'low', 'normal'].includes(p.music ?? '')) return null;
  if (!['in-app', 'sms', 'off'].includes(p.communication ?? '')) return null;
  return {
    difficultyObservation: p.difficultyObservation!, music: p.music!, communication: p.communication!,
    phoneNumber: typeof p.phoneNumber === 'string' ? p.phoneNumber.slice(0, 30) : '',
  };
}

export async function GET(request: NextRequest) {
  const uid = await uidFor(request); if (typeof uid !== 'string') return uid;
  const snap = await adminDb().collection('parents').doc(uid).get();
  return NextResponse.json({ preferences: snap.data()?.preferences ?? null });
}

export async function POST(request: NextRequest) {
  const uid = await uidFor(request); if (typeof uid !== 'string') return uid;
  const preferences = normalize(((await request.json().catch(() => null)) as { preferences?: unknown } | null)?.preferences);
  if (!preferences) return NextResponse.json({ error: 'INVALID_PREFERENCES' }, { status: 400 });
  await adminDb().collection('parents').doc(uid).set({ preferences, updatedAt: new Date().toISOString() }, { merge: true });
  return NextResponse.json({ ok: true, preferences });
}
