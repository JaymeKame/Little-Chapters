/* POST /api/analytics/collect — receives batched non-sensitive events from
 * lib/analytics.ts and writes them to stdout so Vercel's log stream is the
 * V1 dashboard. Deliberately minimal: no persistence, no fan-out, no
 * third-party SDK. That is by design — plug PostHog/Amplitude in later by
 * changing THIS file only, not the 20 call sites in the app.
 *
 * The receiver treats every request as untrusted:
 *   - body size cap (32 KB) to keep a hostile poster from filling logs;
 *   - event names checked against an allow-list;
 *   - properties re-sanitized on the server even though the client already
 *     sanitized, because a browser can be lied to.                        */

import { NextResponse, type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_EVENTS = new Set([
  'landing_view',
  'setup_started', 'setup_completed',
  'chapter_started', 'chapter_completed',
  'unlock_shown',
  'register_started', 'register_completed',
  'checkout_started', 'checkout_completed',
  'subscription_active', 'billing_portal_opened',
  'subscription_canceled', 'payment_failed',
  'story_generation_failed', 'visual_generation_failed', 'tts_failed', 'speech_scoring_failed',
]);

const ALLOWED_PROP_KEYS = new Set(['route', 'authed', 'plan', 'stage', 'interactionType', 'provider', 'fallback', 'errorCategory']);
const MAX_BYTES = 32 * 1024;
const MAX_EVENTS_PER_REQUEST = 64;

interface RawEvent { event?: unknown; props?: unknown; ts?: unknown; sid?: unknown }

function sanitizeProps(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!ALLOWED_PROP_KEYS.has(k)) continue;
    // Coerce to primitives and cap string length so a hostile poster can't
    // blow up the log line.
    if (typeof v === 'string') out[k] = v.slice(0, 80);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_BYTES) return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    const parsed = JSON.parse(raw) as { events?: RawEvent[] };
    const events = Array.isArray(parsed.events) ? parsed.events.slice(0, MAX_EVENTS_PER_REQUEST) : [];
    for (const raw of events) {
      const name = typeof raw.event === 'string' ? raw.event : '';
      if (!ALLOWED_EVENTS.has(name)) continue;
      const props = sanitizeProps(raw.props);
      const sid = typeof raw.sid === 'string' ? raw.sid.slice(0, 64) : 'unknown';
      const ts = typeof raw.ts === 'number' ? raw.ts : Date.now();
      // Structured single-line log so Vercel/Cloud Run log filters can
      // grep for `lc.analytics` and pull the JSON body.
      console.info(`lc.analytics ${JSON.stringify({ event: name, sid, ts, ...props })}`);
    }
    return new NextResponse(null, { status: 204 });
  } catch {
    // Never fail loudly — a hostile or malformed body should just be
    // dropped, not crash the route.
    return new NextResponse(null, { status: 204 });
  }
}
