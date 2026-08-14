# Azure Pronunciation Assessment — setup

The reading-assessment pipeline lives in three pieces:

| Piece | File | What it does |
|---|---|---|
| Token broker | `app/api/speech/token/route.ts` | Exchanges the server-side Azure key for a ~10-min token; the key never reaches the browser. Requires Firebase sign-in when the Admin SDK is configured (i.e. in prod). |
| Client library | `lib/pronunciation.ts` | Opens the mic once, streams it to Azure via the Speech SDK **and** records a playback copy; aggregates per-segment results into passage-level scores. |
| Test page | `app/reading/page.tsx` | Harness UI: pick a sentence, record, see scores / per-word errors / playback / raw JSON. |

## 1. Create the Speech resource (one time, ~2 minutes)

1. Go to <https://portal.azure.com> → **Create a resource** → search **"Speech"** (publisher: Microsoft, under *AI + Machine Learning*) → **Create**.
2. Fill in:
   - **Subscription**: yours.
   - **Resource group**: create one, e.g. `inzone-reading`.
   - **Region**: pick **East US** (`eastus`) unless you have a reason not to — it gets every pronunciation-assessment feature (incl. prosody) first. **West US 2** (`westus2`) and **West Europe** (`westeurope`) are also safe picks. Remember the *identifier* form (`eastus`), not the display name.
   - **Name**: e.g. `inzone-speech`.
   - **Pricing tier**: **Free (F0)** — 5 audio-hours/month, 1 concurrent request; plenty for development. Switch to **Standard (S0)** (~$1 per audio-hour for standard STT) before real users, since F0 throttles hard.
3. **Review + create** → **Create**, then open the resource → **Keys and Endpoint** (left sidebar) → copy **Key 1** and the **Location/Region** value.

CLI alternative:

```bash
az cognitiveservices account create -n inzone-speech -g inzone-reading --kind SpeechServices --sku F0 -l eastus
```

```bash
az cognitiveservices account keys list -n inzone-speech -g inzone-reading
```

## 2. Local env vars

Add to `.env.local` (server-only names — deliberately **not** `NEXT_PUBLIC_*`):

```
AZURE_SPEECH_KEY=<Key 1>
AZURE_SPEECH_REGION=eastus
```

Restart `npm run dev` after editing.

## 3. Try it

Open <http://localhost:3000/reading>, allow the microphone, hit **Start reading**, read the sentence, hit **Stop & score**. You should get overall/accuracy/fluency/completeness/prosody tiles, color-coded words (hover for phonemes), a replayable recording, and the raw Azure JSON under the expander.

No real mic needed for a smoke test — read the sentence yourself; to simulate a kid, read slowly, skip a word, and mumble one: the skipped word should come back red (Omission) and the mumbled one yellow (Mispronunciation).

## 4. Production (Vercel)

- Add `AZURE_SPEECH_KEY` (Sensitive) and `AZURE_SPEECH_REGION` in Vercel → Project → Settings → Environment Variables.
- The token route **fails closed**: outside local dev it refuses to run without `FIREBASE_SERVICE_ACCOUNT` (already set on Vercel), and then requires a signed-in Firebase user. Sign-in blocks anonymous drains; each user is also capped at 30 token grants/hour (in-memory, per serverless instance — a brake, not a hard quota). `SPEECH_ALLOW_UNAUTH=1` is an explicit escape hatch for previews without Firebase.
- Recommended: set an [Azure Cost Management budget alert](https://portal.azure.com → Cost Management → Budgets) on the Speech resource as the real spending backstop.

## 5. Knobs already tuned for a 5-year-old (in `lib/pronunciation.ts`)

- **Continuous recognition**, not one-shot — slow reading with long pauses gets split into segments by Azure; we re-aggregate scores across segments with Microsoft's documented weights.
- `InitialSilenceTimeoutMs = 15000` — child can stare at the page for 15 s before Azure gives up.
- `SegmentationSilenceTimeoutMs = 2200` — a 2.2 s thinking-pause doesn't end the utterance (max Azure allows is 5000).
- **Miscue detection** — Azure doesn't return Omission/Insertion labels in continuous mode, so `lib/pronunciation.ts` re-aligns the recognized words against the reference text client-side (LCS diff, same approach as Microsoft's continuous samples): skipped words → `Omission`, re-reads/made-up words → `Insertion`.
- **Prosody** requested for English locales only; scores come back `null` elsewhere.
- Locale defaults to `en-US`; pass `locale` to `startReadingSession` to change.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `SPEECH_NOT_CONFIGURED` (503) | Env vars missing — step 2, then restart the dev server. |
| `AZURE_TOKEN_FAILED … 401` | Key doesn't match the region — recheck both from **Keys and Endpoint**. |
| `UNAUTHENTICATED` (401) | Prod route requires sign-in; log in via `/login` first. |
| `ADMIN_NOT_CONFIGURED` (503) | Non-dev deployment without `FIREBASE_SERVICE_ACCOUNT` — set it (or `SPEECH_ALLOW_UNAUTH=1` to knowingly run open). |
| `RATE_LIMITED` (429) | More than 30 token grants for one user in an hour — normally means a client-side retry loop. |
| Mic prompt never appears | Must be `localhost` or HTTPS — plain-HTTP LAN IPs are blocked by the browser. |
| Recognition connects, then instant cancel | Usually an expired token after long idling — the library drops its cache on auth errors, so just retry; if persistent, check the resource isn't disabled/out of quota (F0). |
| Scores look too generous | Normal for short sentences. Tune with real kid audio; the raw JSON expander shows exactly what Azure returned per word/phoneme. |
