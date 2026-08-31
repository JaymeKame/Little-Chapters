# Voice and Pacing Audit

## Summary

This audit compares voice-provider options for the Little Chapters TTS path
(`speakPrompt()` in `lib/audio.ts`). ElevenLabs is now the default child-
facing tutor voice whenever `ELEVENLABS_API_KEY` is configured; the browser's
Web Speech API is resilience-fallback only — see "2026-08-21: ElevenLabs
became the default" below for why this changed from the original opt-in
design, and `docs/VOICE_CALLSITE_INVENTORY.md` for the full callsite audit
that prompted it.

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

### Verdict (updated 2026-08-21 — see below)

**ElevenLabs is now the default** whenever `ELEVENLABS_API_KEY` is
configured — every `speakPrompt()` call attempts it first. Web Speech API
remains available with zero setup and is the automatic fallback whenever
ElevenLabs isn't configured or a call genuinely fails (network error,
timeout, or a non-2xx response after one retry). `NEXT_PUBLIC_VOICE_PROVIDER`
still exists but only as an explicit `web-speech` opt-OUT for local dev/
testing the fallback path — it no longer needs to be set to `elevenlabs` to
"activate" anything.

### 2026-08-21: ElevenLabs became the default

Originally this was an explicit opt-in (`NEXT_PUBLIC_VOICE_PROVIDER=elevenlabs`)
kept separate from `ELEVENLABS_API_KEY` (server-only, never exposed to the
client). That separation was a real bug: a deployment could set the API key
— reasonably believing that "activates" ElevenLabs — and still get 100% Web
Speech everywhere, silently, because the separate client-side flag was never
also set. There was no error to notice; it just sounded mechanical. A live
test session surfaced this as "ElevenLabs only heard during the sight-word/
slider correction interaction, mechanical browser TTS everywhere else" —
investigated in full in `docs/VOICE_CALLSITE_INVENTORY.md`, which also
confirmed every child-facing speech callsite already funnels through the
single `speakPrompt()`/`stopSpeaking()` contract (no direct
`speechSynthesis` bypass anywhere in application code). The fix flips the
default so ElevenLabs is attempted unconditionally, and separately adds one
retry-on-transient-failure (network blip / 5xx) before falling back, so a
single dropped packet or a cold serverless function no longer silently
downgrades an entire utterance to the mechanical voice.

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

**2026-08-22 update**: Default switched from `eleven_turbo_v2` to
**`eleven_multilingual_v2`** after a live production report that the voice
"still sounds mechanical" with ElevenLabs already confirmed as the active
provider (routing was not the problem — see the runtime diagnostics section
below). turbo_v2 is ElevenLabs' own documented latency-optimized model,
built for real-time conversational agents; multilingual_v2 is their
documented quality/expressiveness-optimized model, and their own
recommendation for narration/audiobook-style content — which is what this
app's reading-tutor prompts actually are, not a live conversation. The extra
~300-400ms is immaterial against ELEVENLABS_TIMEOUT_MS's 8s budget and the
existing per-text cache. This is a pure model-ID swap (`ELEVENLABS_MODEL_ID`
env override, or the new `DEFAULT_MODEL_ID` in `lib/elevenlabs.server.ts`)
— voice_settings and every callsite are unchanged.

| Model | Latency | Notes |
|---|---|---|
| `eleven_multilingual_v2` | ~700 ms | **Default (2026-08-22)** — ElevenLabs' quality/expressiveness-optimized model |
| `eleven_turbo_v2` | ~350 ms | Previous default — latency-optimized, read as flatter/more clipped on short prompts |
| `eleven_turbo_v2_5` | ~300 ms | Marginally faster than turbo_v2, similarly latency-optimized |
| `eleven_monolingual_v1` | ~500 ms | Legacy; prefer multilingual_v2 |

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
high-style tends to produce on v2 models.

**2026-08-22 update**: the two knobs above were not enough — the same
"sounds mechanical" report recurred in production with ElevenLabs confirmed
active (not a Web Speech fallback). Moved the bigger lever: the model itself
is now `eleven_multilingual_v2` instead of `eleven_turbo_v2` (see "Model
selection" above). Neither change has been verified by ear against a live
ElevenLabs account from this environment — re-run
`npm run test:voice -- --speak "..."` with real credentials and compare, or
use the new `window.__voiceDebug().lastUtterance` / `serverConfig` fields
(see "Runtime diagnostics" below) to confirm which provider/model actually
served a given utterance directly from the deployed browser.

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

# Optional overrides
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
```

That's the whole activation — no separate client-side flag needed (see
"2026-08-21: ElevenLabs became the default" above). To force Web Speech
instead (e.g. testing the fallback path), set
`NEXT_PUBLIC_VOICE_PROVIDER=web-speech`.

Then verify with:

```bash
npm run dev          # in one terminal
npm run test:voice   # in another terminal
npm run test:voice -- --speak "Ready to see what happens today?"
```

The `test:voice` script probes `GET /api/speech/model` (provider metadata) and,
with `--speak "…"`, POSTs a sample phrase and saves the result as `output.mp3`.

---

## Runtime diagnostics (2026-08-22)

`window.__voiceDebug()` — callable from ANY real browser's DevTools console,
on any deployment including production (unlike `__audioDebug()`, this is
deliberately not gated on `NODE_ENV === 'development'`; see the comment
above it in `lib/audio.ts`). Never includes the synthesized text or any
credential. After making the app speak once (tap the welcome pill, header
replay button, etc.), run:

```js
window.__voiceDebug()
```

Two fields answer "what actually just happened" directly, without reading
through the whole log:

- **`serverConfig`** — `{ checked, provider, voiceId, modelId, error }`,
  fetched once from `GET /api/speech/model` and cached. `provider` here is
  the SERVER's truth (is `ELEVENLABS_API_KEY` actually set on this
  deployment), independent of whether any call has succeeded yet.
  `checked: false` means no utterance has fired yet this page load.
- **`lastUtterance`** — `{ requestedProvider, playedProvider, httpStatus,
  fallbackOccurred, fallbackReason, retried, voiceId, modelId, ts }` for the
  MOST RECENT `speakPrompt()` call. `requestedProvider` is what the app tried
  first; `playedProvider` is what actually produced the audio the child
  heard — the two differ exactly when `fallbackOccurred` is true, and
  `fallbackReason` says why (e.g. `"model route 503"` = not configured,
  `"model route 500"` = ElevenLabs/network error, `"timeout (8000ms)"` =
  hung request).

If `serverConfig.provider` is `"elevenlabs"` and `lastUtterance.playedProvider`
is also `"elevenlabs"` with no `fallbackOccurred`, ElevenLabs is genuinely
serving the audio — a mechanical-sounding result at that point is a voice/
model quality question, not a routing failure. If `serverConfig.provider` is
`"web-speech"` (or `.error` is set), `ELEVENLABS_API_KEY` is not visible to
this deployment at all and every utterance falls back deterministically —
that is a configuration issue, not a code bug.

The full bounded history (`recent`, last 20 events) and the `_voiceHistory`-
backed console.debug (`'[Voice]', {...}`) both still work as before, now
also carrying `httpStatus` on every entry.

---

## Architecture

```
Browser (lib/audio.ts)
  speakPrompt(text)
    NEXT_PUBLIC_VOICE_PROVIDER === 'web-speech'? (explicit opt-out only)
      ├─ NO (default) → fetch POST /api/speech/model {text}
      │           ↓
      │         app/api/speech/model/route.ts
      │           ↓
      │         lib/elevenlabs.server.ts → ElevenLabs REST API
      │           (not configured → fast 503, no network hang)
      │           ↓ audio/mpeg stream
      │         HTMLAudioElement.play()
      │         (retries once on a transient failure, then falls back to
      │          Web Speech — see _speakElevenLabs in lib/audio.ts)
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
