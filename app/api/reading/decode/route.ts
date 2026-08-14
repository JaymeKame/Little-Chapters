/* Decoding-grader proxy: forwards the reading recording to the local MDD
 * phoneme service (mdd/server.py) so the browser never talks to it directly.
 *
 *   POST multipart/form-data { audio: <wav blob>, text: <reference text> }
 *   → the service's JSON: { recognized, words: [{word, per, score, …}], … }
 *
 * Same fail-closed auth as /api/speech/token. If the MDD service is down the
 * client falls back to Azure-only verdicts, so this returns a clean 503
 * rather than an opaque error.                                               */

import { NextResponse, type NextRequest } from 'next/server';
import { requireReadingUser } from '@/lib/route-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MDD_SERVER_URL = process.env.MDD_SERVER_URL || 'http://127.0.0.1:8010';
const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // ~110 s at the browser's 48 kHz tap
const MAX_TEXT_CHARS = 600;
const DECODE_TIMEOUT_MS = 60_000;

/* Each accepted request costs the single MDD instance seconds of CPU, so cap
 * per-uid like the token route (in-memory, per serverless instance — a brake,
 * not a hard quota). Legit use is roughly one decode per reading. */
const GRANTS_PER_HOUR = 60;
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

export async function POST(req: NextRequest) {
  const auth = await requireReadingUser(req);
  if (!auth.ok) return auth.response;
  if (overLimit(auth.uid)) return err('RATE_LIMITED', 429, 'Too many decode requests this hour.');

  // Cheap reject before formData() buffers the whole body into memory.
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_AUDIO_BYTES + 8192) return err('AUDIO_TOO_LARGE', 413);

  let audio: File | null = null;
  let text = '';
  try {
    const form = await req.formData();
    const a = form.get('audio');
    audio = a instanceof File ? a : null;
    text = String(form.get('text') ?? '').trim();
  } catch {
    return err('BAD_REQUEST', 400, 'Send multipart/form-data with "audio" (wav) and "text" fields.');
  }
  if (!audio || !text) return err('BAD_REQUEST', 400, 'Both "audio" and "text" are required.');
  if (text.length > MAX_TEXT_CHARS) return err('TEXT_TOO_LONG', 400, `Max ${MAX_TEXT_CHARS} characters.`);
  if (audio.size > MAX_AUDIO_BYTES) return err('AUDIO_TOO_LARGE', 413);

  let res: Response;
  try {
    res = await fetch(`${MDD_SERVER_URL}/assess?text=${encodeURIComponent(text)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: Buffer.from(await audio.arrayBuffer()),
      cache: 'no-store',
      signal: AbortSignal.timeout(DECODE_TIMEOUT_MS),
    });
  } catch {
    return err(
      'DECODER_UNAVAILABLE',
      503,
      `MDD service unreachable at ${MDD_SERVER_URL} — start it with mdd/server.py (see docs/DECODING_GRADER.md).`,
    );
  }
  const body = await res.json().catch(() => ({ error: 'DECODER_BAD_RESPONSE' }));
  return NextResponse.json(body, { status: res.status, headers: { 'Cache-Control': 'no-store' } });
}
