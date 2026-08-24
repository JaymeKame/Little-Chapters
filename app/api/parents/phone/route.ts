/* Stores the parent's SMS number.
 *
 * This exists because the write used to go DIRECT from the browser to
 * `parents/{uid}` through the client Firestore sdk. A phone number is PII,
 * firestore.rules in this repo is headed "PROPOSED, NOT DEPLOYED", and its
 * own comment explains why: the shared inzone-f93e4 project carries a
 * world-readable phase-2a catch-all, and Firestore allows access if ANY
 * matching rule grants it — so a scoped rule for this path would not
 * actually restrict anything while that catch-all stands.
 *
 * Admin sdk writes are not subject to security rules at all, which is
 * exactly why app/api/progress/* was built server-mediated (see
 * docs/PERSISTENCE.md "Security boundary"). Routing the phone number the
 * same way means the client never needs write access to `parents/{uid}`,
 * so this stops depending on rules nobody has been able to deploy.
 *
 * It does NOT make the stored number private — that still needs the
 * catch-all scoped down in the Firebase console. It removes this app as a
 * reason to keep client write access open, and puts validation somewhere a
 * caller cannot skip.                                                       */

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { adminUnconfiguredResponse } from '@/lib/route-auth';
import { INVALID_PHONE_MESSAGE, normalizePhoneNumber } from '@/lib/phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* Same shape of in-memory brake as the other write routes. A parent sets
 * this once at registration and rarely again; anything past this is either
 * a bug or someone poking. */
const WRITES_PER_HOUR = 10;
const WINDOW_MS = 60 * 60 * 1000;
const writes = new Map<string, { windowStart: number; count: number }>();

function overLimit(key: string): boolean {
  const now = Date.now();
  const g = writes.get(key);
  if (!g || now - g.windowStart > WINDOW_MS) {
    writes.set(key, { windowStart: now, count: 1 });
    return false;
  }
  g.count += 1;
  return g.count > WRITES_PER_HOUR;
}

export async function POST(request: NextRequest) {
  try {
    const unconfigured = adminUnconfiguredResponse();
    if (unconfigured) return unconfigured;

    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization header' }, { status: 401 });
    }

    let decodedToken;
    try {
      decodedToken = await adminAuth().verifyIdToken(authHeader.slice(7));
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Anonymous identities are free to mint, and this number is what the
    // operator's Twilio will text — same gate as /api/messages.
    if (decodedToken.firebase?.sign_in_provider === 'anonymous') {
      return NextResponse.json({ error: 'Sign in with a parent account first' }, { status: 403 });
    }

    const uid = decodedToken.uid;
    if (overLimit(uid)) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });

    const body = (await request.json().catch(() => ({}))) as { phoneNumber?: unknown };
    const raw = typeof body.phoneNumber === 'string' ? body.phoneNumber : '';
    const normalized = normalizePhoneNumber(raw);
    if (!normalized) {
      return NextResponse.json({ error: INVALID_PHONE_MESSAGE }, { status: 400 });
    }

    // merge: this doc also carries stripeCustomerId/subscriptionStatus,
    // written by checkout and the webhook. Never clobber them.
    await adminDb().collection('parents').doc(uid).set(
      {
        phoneNumber: normalized,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    return NextResponse.json({ ok: true, phoneNumber: normalized });
  } catch (error) {
    console.error('Error saving parent phone number:', error);
    return NextResponse.json({ error: 'Unable to save that number right now.' }, { status: 500 });
  }
}
