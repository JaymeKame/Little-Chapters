# Little Chapters™ — project guide

A daily-chapter reading app for early readers (~age 5). A parent sets up a
story profile in <30 s; the child reads today's chapter aloud 1–2 sentences at
a time; the app listens, judges *decoding* (did they read the right word?),
helps gently, and sends the parent a warm, score-free note. Momo the reading
pet gives kids a reason to return tomorrow.

## Product principles (from the design mockup — do not violate)

- Child screens: **one big button**, no reading required to navigate.
- Corrections are **blue, never red**, and **never block** — one gentle retry
  ("Let's try that word together."), then the story continues.
- Parents get **no scores, no comparisons** — what was practiced, new words,
  tomorrow's hook. "Permission, not guilt."
- Only 1–2 sentences per page. Chapter ends on a cliffhanger:
  "To be continued tomorrow..."
- Palette: Leaf `#2E7D63`, Sunshine `#F4C95D`, Sky `#7EB7E6`, Stone
  `#F5EFE6`, Ink `#2B2B2B` (tokens in `app/globals.css`). Reading text is
  **Lexend**; storybook/display moments are the serif (Lora). No Tailwind —
  inline styles + token CSS on purpose.

## Route map

`/` landing (parent) → `/setup` (name/age/pick-3 interests → localStorage
profile, **no accounts**) → `/home` (child: play button + Momo) → `/read`
(core reading flow + chapter-end) → `/parent` (session note).
`/dev/assess` is an internal pipeline harness. Chapter content is static demo
text personalized by top interest (`lib/chapters.ts`) — the AI chapter-writer
is the next milestone.

## How reading is judged — the part that looks wrong but isn't

Commercial pronunciation APIs (Azure, SpeechAce) answer "how native-like?",
an L2 question — they're deliberately lenient on flawed-but-intelligible
child speech, and Azure's STT language model silently snaps a misread word
("cot") back to the expected word ("cat") before assessment even starts. We
calibrated on speechocean762 (100 clips, 431 expert-scored child words):
Azure word scores passed every clearly-misread word at 70–91.

So two graders vote on every word (`lib/reading-verdict.ts`):

1. **Azure pronunciation assessment** (streaming, browser → websocket) —
   transcript, fluency, prosody, per-phoneme scores. Phoneme minima carry the
   real signal; word scores are lenient.
2. **MDD phoneme service** (`mdd/`, self-hosted wav2vec2, lexicon-free CTC
   decode + CMUdict edit distance) — catches wrong-word decoding because
   nothing snaps to the expected word.

**Flag a word only when BOTH object** (MDD score <70 AND Azure min-phoneme
<50). Either alone is far too trigger-happy for a 5-year-old (raw MDD flagged
38% of expert-perfect words). If the MDD service is down, the app silently
degrades to Azure-only (min-phoneme <40). The thresholds live in
`VERDICT_THRESHOLDS` with their calibration provenance — **don't retune them
by feel**; rerun a calibration against expert-labeled clips (method + numbers
in `docs/DECODING_GRADER.md`).

## Non-obvious technical facts (each cost real debugging to learn)

- **Azure continuous mode never returns Omission/Insertion miscue labels**,
  even with `enableMiscue=true`. `lib/pronunciation.ts` re-aligns recognized
  words against the reference text client-side (LCS), like Microsoft's own
  continuous samples. Don't "simplify" this away.
- **Azure token expiry surfaces as `ConnectionFailure`, not
  `AuthenticationFailure`** — the canceled handler drops the token cache on
  any error for that reason.
- Kid-tuned SDK timeouts: 15 s initial silence, 2.2 s segmentation pause
  (children think mid-sentence). The `/read` flow auto-stops after ~3 s of
  true silence — the timer is re-armed by every PARTIAL transcript, not just
  finalized segments, so a child who pauses and resumes is never cut off
  (and the grace must stay above the 2.2 s segmentation pause).
- The Azure key is **server-only**; the browser gets a ~10-min token from
  `/api/speech/token` (auto-refreshed every 4 min mid-session). Both API
  routes share a fail-closed auth gate (`lib/route-auth.ts`): Firebase ID
  token required when `FIREBASE_SERVICE_ACCOUNT` is set; open only in local
  dev or with `SPEECH_ALLOW_UNAUTH=1`; per-uid rate caps.
- The MDD service rejects audio >60 s and text >600 chars, runs inference in
  a threadpool (health stays responsive), and returns 422 `UNKNOWN_WORD` for
  words missing from CMUdict — add names to `MANUAL_PRONS` in `mdd/grader.py`
  (or `MDD_EXTRA_PRONS` json). CPU inference ~1–2 s/clip; no GPU needed.
- **Pet state** (`lib/pet.ts`): localStorage keys are per-uid
  (`little-chapters-pet:<uid|anon>`) so siblings on one device don't clobber
  each other. Streaks use the LOCAL calendar day and survive clock rollbacks.
  A Firestore mirror (`readingPets/{uid}`) exists in code but the rule is
  **deliberately not deployed** — the shared Firebase project's phase-2a
  rules have a world-readable catch-all, and this is kids' data. localStorage
  carries everything until that's resolved.
- Firebase project is currently the shared `inzone-f93e4` (config via env).
  The app renders fully without any Firebase config (anonymous mode).
- The font tokens in `globals.css` MUST keep their in-var fallbacks
  (`var(--font-lexend, 'Lexend')`): without one, a missing next/font variable
  invalidates the whole token at computed-value time and every screen
  collapses to the browser default font (Times).
- **Live karaoke highlight** (`lib/live-progress.ts`): words light up as the
  child reads, driven by Azure PARTIAL transcripts. It tracks the child's
  POSITION, never correctness (misreads/skips are jumped or re-anchored via
  bigram search; a repeat of the just-matched word is a stutter, not an
  advance; the cursor is monotonic — never retreats). Its word tokenizer and
  `PageText`'s in `app/read/page.tsx` MUST change in lockstep (fold curly
  apostrophes, keep digits, hyphenated words count once) or the highlight
  index drifts. Azure only finalizes phoneme detail per utterance, so
  phoneme-level LIVE feedback is impossible with this engine — word-level is
  the floor. Test with the `sim: live` dev button (mic-free).

## Dev workflow

```bash
npm run dev          # http://localhost:3001
npm run typecheck    # strict TS; keep it clean
cd mdd && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python server.py   # decoding grader on :8010 (first run downloads ~1.3 GB model)
```

- **Never run `npm run build` while the dev server is running** — they share
  `.next/`, and the production build clobbers the dev server's asset
  manifests: every page then loads unstyled (CSS 404s) until the dev server
  is stopped, `.next/` deleted, and restarted. Stop dev first, or let Vercel
  do the building and run only `npm run typecheck` locally.
- Azure resource setup (one-time, free tier): `docs/AZURE_SPEECH_SETUP.md`;
  fill `.env.local` from `.env.local.example`.
- **No mic needed to develop**: `/read` and `/dev/assess` show `sim: good` /
  `sim: tricky` buttons in dev builds that drive the whole verdict/pet/report
  flow with fabricated results.
- `node scripts/assess-wav.ts <wav> "<reference>"` runs any recording through
  the real Azure scoring path (`aggregate()` is exported for offline
  re-scoring); `scripts/assess-speechace.ts` is the vendor-comparison twin.
- No test framework yet; pure logic (`lib/pet.ts`, `aggregate()`) is designed
  to be exercised with plain `node` scripts against the real modules.

## Deeper docs

- `docs/DECODING_GRADER.md` — grader architecture + full calibration study
- `docs/PET_SYSTEM.md` — Momo's rules + the away-reminder (push) roadmap:
  VAPID + daily cron + **parental consent surface first** (kids' data)
- `docs/AZURE_SPEECH_SETUP.md` — Azure resource + env setup, troubleshooting

## Roadmap (agreed, in order)

1. AI chapter-writer (replace `lib/chapters.ts` static content)
2. Parent push messages / away reminders (see PET_SYSTEM.md — consent first)
3. Accounts + Firestore persistence (deploy `readingPets` rule only alongside
   scoped-read rules; never under a public-read catch-all)
4. Grader threshold refinement once real target-user recordings exist
