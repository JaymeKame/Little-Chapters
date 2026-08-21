/* GET  /api/speech/model   — returns the active voice-provider configuration.
 * POST /api/speech/model   — synthesizes text and streams back audio/mpeg.
 *
 * Provider selection:
 *   When ELEVENLABS_API_KEY is present the POST path calls ElevenLabs and
 *   streams audio/mpeg back to the browser for playback via HTMLAudioElement.
 *   When the key is absent the GET response tells callers to fall back to the
 *   browser's Web Speech API; POST returns 503.
 *
 * Text limits: 5 000 chars (ElevenLabs API cap is 5 000 per request; the
 * reading app never sends more than ~200 chars per prompt so this is generous).
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  isConfigured,
  synthesize,
  DEFAULT_VOICE_ID,
  DEFAULT_MODEL_ID,
} from '@/lib/elevenlabs.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TEXT_CHARS = 5_000;

export async function GET(): Promise<NextResponse> {
  if (!isConfigured()) {
    return NextResponse.json({
      provider: 'web-speech',
      note: 'ELEVENLABS_API_KEY not set — browser Web Speech API is active.',
    });
  }

  return NextResponse.json({
    provider: 'elevenlabs',
    voiceId: process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID,
    modelId: process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_MODEL_ID,
    note: 'ElevenLabs TTS is active.',
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: 'ElevenLabs not configured — use Web Speech API fallback.' },
      { status: 503 },
    );
  }

  let text: string;
  try {
    const body = (await req.json()) as { text?: unknown };
    if (typeof body.text !== 'string' || !body.text.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }
    text = body.text.trim().slice(0, MAX_TEXT_CHARS);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const upstream = await synthesize(text);
    // Forward the ElevenLabs stream directly — avoids buffering the entire clip
    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'TTS synthesis failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
