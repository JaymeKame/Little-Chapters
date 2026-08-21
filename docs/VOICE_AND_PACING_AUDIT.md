# Voice and Pacing Audit

## Summary

This audit compares voice-provider options for the Little Chapters TTS path
(`speakPrompt()` in `lib/audio.ts`) and documents the decision to add
ElevenLabs as an opt-in provider while keeping the browser's Web Speech API
as the default.

---

## Providers compared

| Dimension | Web Speech API (browser) | ElevenLabs (server-streamed) |
|---|---|---|
| **Latency** | < 50 ms (local engine) | 300–800 ms (network + inference) |
| **Voice quality** | Device-dependent; often robotic on Windows/Android | Consistently warm, natural; passes informal child-listener tests |
| **Reliability** | Always available (no key, no quota) | Requires API key; subject to free-tier character quota |
| **Privacy** | Audio never leaves the device | Text is sent to ElevenLabs servers |
| **Cost** | Free | Free tier: 10 000 chars/month; paid from $5/month |
| **Setup** | None | `ELEVENLABS_API_KEY` in `.env.local` |

### Verdict

**Web Speech API remains the default** — zero-dependency, zero-latency, and
works offline. ElevenLabs is available as an opt-in via
`NEXT_PUBLIC_VOICE_PROVIDER=elevenlabs` for deployments that can accept the
latency and privacy trade-offs, e.g. a future parent-managed hosted version.

---

## ElevenLabs configuration

### Voice selection

Default: **Rachel** (`EXAVITQu4vr4xnSDxMaL`) — warm, calm, well-suited to
short story prompts for young children. Override via `ELEVENLABS_VOICE_ID`.

Alternatives auditioned:

| Voice | ID | Notes |
|---|---|---|
| Rachel | `EXAVITQu4vr4xnSDxMaL` | **Default** — warm, clear, slow enough for 5-year-olds |
| Domi | `AZnzlk1XvdvUeBnXmlld` | Energetic; slightly fast |
| Bella | `29vD33N1CtxCmqQRPOHJ` | Similar to Rachel; alternative if Rachel quota is hit |
| Josh | `TxGEqnHWrfWFTfGW9XjX` | Deeper male voice; good for certain characters |

### Model selection

Default: **eleven_turbo_v2** — lowest latency among current v2 models
(< 400 ms server-side) while retaining natural prosody.

| Model | Latency | Notes |
|---|---|---|
| `eleven_turbo_v2` | ~350 ms | **Default** — best balance |
| `eleven_turbo_v2_5` | ~300 ms | Marginally faster, slightly less expressive |
| `eleven_multilingual_v2` | ~700 ms | Only needed for non-English localisation |
| `eleven_monolingual_v1` | ~500 ms | Legacy; prefer turbo_v2 |

### Voice settings rationale

```
stability:        0.55  — balanced; avoids both monotone and over-expressive
similarity_boost: 0.75  — close to cloned voice without over-fitting
style:            0.25  — light natural expressiveness (0.0 read as flat/mechanical)
use_speaker_boost: true — sharpens clarity; minimal latency cost
```

**2026-08-21 update**: `stability`/`style` moved from 0.50/0.00 to 0.55/0.25
in response to a live-tested "sounds mechanical" report. 0.00 style is
ElevenLabs' fully-neutral setting, which on this voice reads closer to flat
than warm; a small style lift plus a slightly higher stability floor targets
"expressive but not theatrical" without the instability that low-stability +
high-style tends to produce on v2 models. Not verified by ear against a live
ElevenLabs account in the environment this change was made in — re-run
`npm run test:voice -- --speak "..."` with real credentials and compare.

If a listen-through says these two knobs aren't enough, the model/voice
themselves are the bigger lever — try `eleven_multilingual_v2`
(`ELEVENLABS_MODEL_ID=eleven_multilingual_v2`) for materially more natural
prosody at ~700ms latency instead of ~350ms; no code change needed, it's
already an env-var override.

---

## Pacing notes

`speakPrompt()` is called for:

1. Welcome line on Screen 3 — typically 10–15 words.
2. Reading-prompt sentence — varies; usually < 30 words.
3. Help ladder rungs — 1–2 sentences.

At the Web Speech API default (`rate: 0.95`), a 15-word sentence takes
≈ 6 s. ElevenLabs does not expose a runtime rate parameter — pacing is baked
into the voice model. Rachel at default settings produces similar natural
pacing for early-reader prompts.

If a future version needs explicit pacing control with ElevenLabs, the
`speech_boost` parameter and short pauses inserted as `" ... "` in the text
are the recommended levers (no official rate multiplier in the v1 API).

---

## Character-quota estimate

Typical session:
- Welcome line:    ~15 chars
- Help rungs (×2): ~120 chars
- Page prompts (×4): ~200 chars

**Total per session: ~335 chars**

Free tier (10 000 chars/month) supports ~30 sessions/month. A $5/month
Starter plan (30 000 chars) covers ~90 sessions — adequate for a single-family
pilot. Revisit at scale.

---

## How to activate ElevenLabs

```bash
# .env.local
ELEVENLABS_API_KEY=sk_...
NEXT_PUBLIC_VOICE_PROVIDER=elevenlabs

# Optional overrides
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
ELEVENLABS_MODEL_ID=eleven_turbo_v2
```

Then verify with:

```bash
npm run dev          # in one terminal
npm run test:voice   # in another terminal
npm run test:voice -- --speak "Ready to see what happens today?"
```

The `test:voice` script probes `GET /api/speech/model` (provider metadata) and,
with `--speak "…"`, POSTs a sample phrase and saves the result as `output.mp3`.

---

## Architecture

```
Browser (lib/audio.ts)
  speakPrompt(text)
    NEXT_PUBLIC_VOICE_PROVIDER === 'elevenlabs'?
      ├─ YES → fetch POST /api/speech/model {text}
      │           ↓
      │         app/api/speech/model/route.ts
      │           ↓
      │         lib/elevenlabs.server.ts → ElevenLabs REST API
      │           ↓ audio/mpeg stream
      │         HTMLAudioElement.play()
      │         (falls back to Web Speech on any error)
      └─ NO  → window.speechSynthesis.speak()
```

The `speakPrompt()` and `stopSpeaking()` public signatures are unchanged;
all provider-selection logic is internal.

### 2026-08-21 additions

- **Text preprocessing**: `speakPrompt()` now appends a period to any prompt
  without terminal punctuation before handing it to either provider. The
  help ladder speaks single bare words in isolation (e.g. "chug") — with no
  punctuation these came out sounding like a clipped dictionary-pronunciation
  clip rather than a naturally spoken word; ending punctuation gives the
  synthesizer a normal sentence-final intonation cue even for one word.
- **Caching**: a small in-memory `Map<string, Blob>` (24 entries, LRU) caches
  ElevenLabs clips by exact synthesized text. Encouragement lines, common
  phonics words, and the welcome line repeat often within a session; a
  repeat now plays instantly instead of re-paying the network + synthesis
  round trip. Session-lifetime only, no persistence.
- **Runtime verification**: `speakPrompt()` now logs which provider actually
  served each call via `console.debug('[Voice]', ...)` — `{provider:
  'elevenlabs', cache: 'hit'|'miss', ...}` on success, or `{provider:
  'elevenlabs', fallback: 'web-speech', reason: ...}` when ElevenLabs failed
  and the call silently fell back. Same pattern as the reading-verdict
  diagnostics in `app/read/page.tsx`: `console.debug` rather than a
  `NODE_ENV` check, since `next build` sets `NODE_ENV=production` on every
  Vercel deployment including previews. To confirm a real correction
  interaction actually played ElevenLabs audio (not a silent Web Speech
  fallback), open DevTools, enable "Verbose"/"Debug" level logging, and
  trigger a help-ladder word — look for `provider: 'elevenlabs'` with no
  `fallback` key.
