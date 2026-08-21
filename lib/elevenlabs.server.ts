/* Server-only ElevenLabs TTS helper for Little Chapters.
 * Imported only by API routes — never bundled into the browser.
 *
 * Environment variables (all optional; fall back to Web Speech API when unset):
 *   ELEVENLABS_API_KEY    — your ElevenLabs API key
 *   ELEVENLABS_VOICE_ID   — override the default voice (Rachel / EXAVITQu4vr4xnSDxMaL)
 *   ELEVENLABS_MODEL_ID   — override the default model (eleven_turbo_v2)
 *
 * Voice selection rationale (see docs/VOICE_AND_PACING_AUDIT.md):
 *   "Rachel" is warm, clear, and passes informal child-listener tests at the
 *   default stability/similarity settings. eleven_turbo_v2 adds < 400 ms
 *   server latency vs the non-turbo model and stays within the free-tier
 *   character quota for typical session lengths (< 2 000 chars / session).
 */

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

/** Default voice: Rachel — warm, calm, suitable for children's stories. */
export const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';
/** Default model: eleven_turbo_v2 — low latency, high quality. */
export const DEFAULT_MODEL_ID = 'eleven_turbo_v2';

export interface ElevenLabsOptions {
  voiceId?: string;
  modelId?: string;
  /** 0–1. Higher = more consistent delivery. Default 0.50. */
  stability?: number;
  /** 0–1. Closer to 1 = closer to the voice clone. Default 0.75. */
  similarityBoost?: number;
  /** 0–1 (v2 models only). Adds expressiveness. Default 0.0 (neutral/safe). */
  style?: number;
  speakerBoost?: boolean;
}

/** True when ELEVENLABS_API_KEY is present in the environment. */
export function isConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

/** Stream synthesized audio for `text` from the ElevenLabs /stream endpoint.
 *  Returns the raw Response — the caller should forward it directly (audio/mpeg).
 *  Throws on non-2xx ElevenLabs responses. */
export async function synthesize(
  text: string,
  opts: ElevenLabsOptions = {},
): Promise<Response> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not configured');

  const voiceId =
    opts.voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID;
  const modelId =
    opts.modelId ?? process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_MODEL_ID;

  const payload = {
    text,
    model_id: modelId,
    voice_settings: {
      stability: opts.stability ?? 0.5,
      similarity_boost: opts.similarityBoost ?? 0.75,
      style: opts.style ?? 0.0,
      use_speaker_boost: opts.speakerBoost ?? true,
    },
  };

  const res = await fetch(
    `${ELEVENLABS_BASE}/text-to-speech/${voiceId}/stream`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`ElevenLabs ${res.status}: ${msg}`);
  }

  return res;
}

/** Fetch the list of available voices — useful for the model metadata endpoint. */
export async function listVoices(): Promise<{ voice_id: string; name: string }[]> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return [];
  const res = await fetch(`${ELEVENLABS_BASE}/voices`, {
    headers: { 'xi-api-key': apiKey },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    voices?: { voice_id: string; name: string }[];
  };
  return data.voices ?? [];
}
