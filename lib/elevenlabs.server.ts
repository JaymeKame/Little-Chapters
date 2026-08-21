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
 *
 * Voice-settings tuning (2026-08-21, see docs/VOICE_AND_PACING_AUDIT.md's
 * "mechanical" audit): stability and style nudged from the original 0.50/0.00
 * — 0.00 style is ElevenLabs' fully-neutral setting, which on this voice
 * reads closer to flat/clipped than warm, and the "sounds mechanical"
 * complaint on a genuine correction interaction is consistent with that. Not
 * verified by ear in THIS environment (no ELEVENLABS_API_KEY configured
 * here to synthesize and listen) — this is ElevenLabs' own documented
 * parameter semantics applied to a named symptom, not a blind guess, but it
 * still wants a real listen-through with real credentials before shipping
 * further. Rerun `npm run test:voice -- --speak "..."` after changing either
 * value and compare by ear; if it still isn't right, the voice/model itself
 * (not these two knobs) is almost certainly the bigger lever — see the
 * updated "Alternatives" table in the audit doc.
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
      // 0.55 (was 0.50): slightly more consistent delivery without tipping
      // into monotone — the "expressive but not theatrical" target pairs a
      // moderate stability floor with a small style push, rather than
      // relying on low stability for expressiveness (that combination is
      // what tends to read as unstable/theatrical on ElevenLabs' v2 models).
      stability: opts.stability ?? 0.55,
      similarity_boost: opts.similarityBoost ?? 0.75,
      // 0.25 (was 0.00): 0.0 is ElevenLabs' fully-neutral style setting,
      // which reads closer to flat/clipped than warm on this voice — a
      // modest lift adds natural sentence-level expressiveness without the
      // exaggeration 0.0 was originally chosen to avoid.
      style: opts.style ?? 0.25,
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
