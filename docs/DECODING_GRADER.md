# Decoding grader (MDD) — "did the child read the right word?"

Azure pronunciation assessment answers *"how native-like was this?"* — an L2
question, deliberately tolerant. A reading app for 5-year-olds needs a
different question answered: **word identity**. "Cat" read as "cot" is a
decoding failure; "cat" read with a lisp is correct decoding. Azure's STT
language model actively hides decoding failures by snapping misreadings back
to the expected word.

The fix (validated against speechocean762 expert scores, see calibration
below): a **lexicon-free phoneme recognizer** (wav2vec2 CTC,
`facebook/wav2vec2-xlsr-53-espeak-cv-ft`) transcribes what the child actually
said as phonemes; we compare that against the expected CMUdict pronunciation
(all variants) by edit distance. No language model → nothing snaps to the
expected word.

## Architecture

```
browser (lib/pronunciation.ts)
  ├─ Azure Speech SDK  ── websocket ──►  Azure   (transcript, fluency,
  │                                              prosody, phoneme scores)
  └─ WAV tap (WebAudio) ─► /api/reading/decode ─► mdd/server.py (this repo)
                                                  (per-word decode scores)
lib/reading-verdict.ts combines both into per-word needsHelp flags.
```

A word is flagged **only when both graders object** (`lib/reading-verdict.ts`,
`VERDICT_THRESHOLDS`): MDD word score < 70 AND Azure min-phoneme < 50. If the
MDD service is down, the app falls back to Azure-only (min-phoneme < 40) —
degraded but functional.

## Running the MDD service

```bash
cd mdd
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python server.py
```

First run downloads the ~1.3 GB model from HuggingFace. CPU-only, ~1–2 s per
clip — no GPU needed at v1 scale. Listens on `127.0.0.1:8010` (override:
`MDD_PORT`); the Next.js route finds it via `MDD_SERVER_URL`. Never expose it
to the public internet unauthenticated — the route (`app/api/reading/decode`)
is the only intended caller and carries the Firebase auth gate. When hosting
the service outside localhost (e.g. Cloud Run), set `MDD_API_KEY` on both the
service and the Vercel deploy: the route forwards it as a bearer token and
`/assess` rejects requests without a matching one. `/healthz` stays
unauthenticated so a platform's startup probe can check readiness without the
secret. Leaving `MDD_API_KEY` unset on both sides preserves the original
zero-configuration local workflow.

Words missing from CMUdict (kid names etc.): add to `MANUAL_PRONS` in
`mdd/grader.py`, or point `MDD_EXTRA_PRONS` at a JSON file
(`{"word": ["ARPABET1 ARPABET2 …"]}`). The service returns 422 UNKNOWN_WORD
listing the word when it hits one.

## Deploying on Cloud Run

`mdd/Dockerfile` builds a CPU-only image with the phoneme model baked in at
build time (`RUN python -c "from grader import Grader; Grader()"`), so a
scale-from-zero cold start never depends on Hugging Face being reachable or
downloading 1.3 GB at runtime. Sizing is deliberately conservative — 2 vCPU,
4 GiB, concurrency 1, min 0 / max 1 instances — since there's no measured
peak-RSS benchmark yet; tighten it once real traffic gives you numbers.

Prerequisites: an existing, billing-enabled GCP project, and an Artifact
Registry Docker repository named `little-chapters` already created in it.
`deploy-cloud-run.sh` deliberately does not infer a project or create one
solely for this service — do not create GCP infrastructure or billing on
someone's behalf without being asked.

One-time setup (once you have a project and region in mind):

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  --project PROJECT_ID
gcloud artifacts repositories create little-chapters \
  --project PROJECT_ID --location REGION --repository-format docker
```

Deploy:

```bash
export MDD_API_KEY=$(openssl rand -hex 32)
mdd/deploy-cloud-run.sh PROJECT_ID REGION
```

The script builds the image via Cloud Build, deploys to Cloud Run with
`--allow-unauthenticated` (Cloud Run's IAM-based private ingress isn't
reachable from Vercel without extra credential plumbing, so the
`MDD_API_KEY` bearer secret is the real access control on `/assess`), and
prints the resulting `MDD_SERVER_URL` / `MDD_API_KEY` pair. Add both to
Vercel's **Preview** environment variables and redeploy.

Verify:

```bash
curl --fail --retry 12 --retry-all-errors --retry-delay 10 https://<service-url>/healthz
# -> {"ok":true,"model":"facebook/wav2vec2-xlsr-53-espeak-cv-ft"}

curl -i -X POST "https://<service-url>/assess?text=cat" --data-binary @/dev/null
# -> 401, no Authorization header supplied
```

Then confirm the deployed app is actually using both graders: read a
sentence on the Vercel preview and check the browser console for the
`[Verdict]` diagnostic table (`app/read/page.tsx`'s `logVerdictDiagnostics()`)
— it should show `graders: "azure+mdd"` with a numeric `decodeScore`. As a
negative check, temporarily point `MDD_SERVER_URL` at an unreachable HTTPS
URL and redeploy: the table should fall back to
`graders: "azure-only (MDD unreachable)"` with `decodeScore: null`, proving
the degraded path still works. Restore the correct `MDD_SERVER_URL`
immediately after.

### Cold-start latency

`--min 0` (scale-to-zero) means the request that resumes an idle service pays
the full cold-start cost before it gets a response: container boot, then
`Grader()` loading the checkpoint (`@app.on_event('startup')` in
`mdd/server.py` — this already runs exactly once per container, not once per
request; that part was correct before this note was written). Two app-side
optimizations reduce that load itself: `HF_HUB_OFFLINE=1`/
`TRANSFORMERS_OFFLINE=1` (set in `mdd/Dockerfile`, after the build-time
caching step) stop every cold start from making a network round-trip to
huggingface.co to check the already-cached files are current; `grader.py`'s
`AutoModelForCTC.from_pretrained(..., low_cpu_mem_usage=True)` avoids
materializing a redundant full-precision copy of the checkpoint while
loading it. Neither has been measured against a live deployment from this
environment (no reachable Cloud Run instance or `gcloud` credentials here) —
they're real, standard, zero-risk wins for this specific slow step, not a
substitute for measuring.

**The dominant remaining cost is infrastructure, not application code**: a
`--min 0` service cold-starts on every idle-then-resume regardless of how
fast `Grader()` loads. The fix is keeping one instance warm:

```bash
gcloud run services update SERVICE_NAME \
  --project PROJECT_ID --region REGION --min-instances=1
```

(or pass `MDD_MIN_INSTANCES=1` to `deploy-cloud-run.sh` on a fresh deploy).
This has an ongoing cost — one 2 vCPU/4 GiB instance running continuously —
traded against eliminating cold starts entirely. To actually measure
warm vs. cold on your deployment:

```bash
# Cold: right after `gcloud run services update ... --min-instances=0` and
# enough idle time to actually scale down (check the Cloud Run console),
# or right after a fresh deploy.
curl -w '\ncold: %{time_total}s\n' -o /dev/null -s https://<service-url>/healthz

# Warm: the same call again, immediately after.
curl -w '\nwarm: %{time_total}s\n' -o /dev/null -s https://<service-url>/healthz
```

## Calibration (speechocean762, ages ≤7, 100 clips / 431 expert-scored words)

| System | word-level r | AUC (imperfect) | clearly-bad caught |
|---|---|---|---|
| Azure word scores | 0.11 | 0.70 | 0/3 → words passed at 70–91 |
| SpeechAce word scores | 0.24 | 0.61 | 2/3 |
| **MDD phoneme scores** | **0.32** | **0.79** | 3/3 |

Hybrid operating point (grid-searched on the 431 words): precision 0.34,
recall 0.49, 15/20 clearly-bad caught, 13.5% false flags on expert-perfect
words. Two caveats: the corpus is Chinese-L2 children scored under L2-lenient
criteria (some "false" flags are the grader correctly hearing accent — US-kid
precision should be better), and thresholds should be re-tuned when real
target-user recordings exist. Re-run the calibration with the scripts
preserved in the session scratchpad (`mdd-test.py`, `assess-batch.ts`,
threshold grid search) against any clip set with expert labels.
