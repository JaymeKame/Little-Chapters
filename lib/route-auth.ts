/* Shared auth gate for the reading-pipeline API routes (/api/speech/token,
 * /api/reading/decode): fail closed outside local dev.
 *
 *  - Admin SDK configured (prod/Vercel): require a Firebase ID token.
 *  - Not configured: allow only in local dev, or with the explicit
 *    SPEECH_ALLOW_UNAUTH=1 escape hatch — otherwise 503.
 *
 * Returns the caller's uid ('anonymous' in dev) for rate-limit keying.       */

import { NextResponse, type NextRequest } from 'next/server';
import { adminAuth, adminCredentialsConfigured } from '@/lib/firebase-admin';

export type RouteAuth = { ok: true; uid: string } | { ok: false; response: NextResponse };

export async function requireReadingUser(req: NextRequest): Promise<RouteAuth> {
  const deny = (error: string, status: number, hint?: string): RouteAuth => ({
    ok: false,
    response: NextResponse.json({ error, ...(hint ? { hint } : {}) }, { status }),
  });

  if (adminCredentialsConfigured()) {
    const header = req.headers.get('authorization') || '';
    const idToken = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!idToken) return deny('UNAUTHENTICATED', 401, 'Sign in first — this route requires a Firebase ID token.');
    try {
      const decoded = await adminAuth().verifyIdToken(idToken);
      return { ok: true, uid: decoded.uid };
    } catch {
      return deny('UNAUTHENTICATED', 401);
    }
  }
  if (process.env.NODE_ENV !== 'development' && process.env.SPEECH_ALLOW_UNAUTH !== '1') {
    return deny(
      'ADMIN_NOT_CONFIGURED',
      503,
      'Set FIREBASE_SERVICE_ACCOUNT so reading routes can authenticate callers (or SPEECH_ALLOW_UNAUTH=1 to explicitly run open).',
    );
  }
  return { ok: true, uid: 'anonymous' };
}
