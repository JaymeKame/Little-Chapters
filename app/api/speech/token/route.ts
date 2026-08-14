/* Azure Speech token broker for the reading-assessment pipeline.
 *
 * The browser-side Speech SDK must never see AZURE_SPEECH_KEY, so this route
 * exchanges it server-side for a short-lived (~10 min) authorization token;
 * the client connects straight to Azure's websocket with that token
 * (SpeechConfig.fromAuthorizationToken), so no audio flows through us.
 *
 *   GET → { token, region }
 *
 * Auth fails closed: a Firebase ID token is required whenever the Admin SDK
 * is configured, and an unconfigured Admin SDK is only tolerated in local dev
 * (or with the explicit SPEECH_ALLOW_UNAUTH=1 escape hatch) — otherwise 503,
 * matching the other gated routes. A per-uid fixed-window cap bounds how fast
 * anyone can mint tokens; legit use needs ≤ ~8/hour (the client caches for
 * 4 min and refreshes mid-session every 4 min).                              */

import { NextResponse, type NextRequest } from 'next/server';
import { requireReadingUser } from '@/lib/route-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* Per-instance in-memory cap — resets on cold start and is per serverless
 * instance, so treat it as a brake on runaway clients, not a hard quota.
 * (An Azure Cost Management budget alert is the real backstop — see docs.)  */
const GRANTS_PER_HOUR = 30;
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
  return g.count > GRANTS_PER_HOUR;
}

function err(code: string, status: number, hint?: string) {
  return NextResponse.json({ error: code, ...(hint ? { hint } : {}) }, { status });
}

export async function GET(req: NextRequest) {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) {
    return err(
      'SPEECH_NOT_CONFIGURED',
      503,
      'Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in .env.local (see docs/AZURE_SPEECH_SETUP.md), then restart the dev server.',
    );
  }

  const auth = await requireReadingUser(req);
  if (!auth.ok) return auth.response;

  if (overLimit(auth.uid)) {
    return err('RATE_LIMITED', 429, 'Too many speech tokens requested this hour — try again later.');
  }

  let res: Response;
  try {
    res = await fetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': key },
      cache: 'no-store',
    });
  } catch {
    return err(
      'AZURE_TOKEN_FAILED',
      502,
      `Could not reach Azure for region "${region}". Check that AZURE_SPEECH_REGION is the region identifier (e.g. "eastus", not "East US") and that outbound network access works.`,
    );
  }
  if (!res.ok) {
    // 401/403 here means a bad key or wrong region — the two setup mistakes.
    return err(
      'AZURE_TOKEN_FAILED',
      502,
      `Azure issueToken returned ${res.status}. Check that AZURE_SPEECH_KEY matches the resource in region "${region}".`,
    );
  }
  const token = await res.text();
  return NextResponse.json({ token, region }, { headers: { 'Cache-Control': 'no-store' } });
}
