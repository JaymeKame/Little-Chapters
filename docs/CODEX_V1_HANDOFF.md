# Little Chapters V1 — Codex Handoff

Written 2026-08-31. This document is the single reference Codex needs to
continue the V1 release-certification work without rereading every prior PR,
audit, or historical CLAUDE.md revision. Read this end to end before touching
code.

---

## 1. Mission

**Little Chapters V1 objective:** a parent can discover, set up, pay, and
manage the product; a child can complete a coherent personalized interactive
reading story; the business can measure the funnel; failures recover
gracefully.

**Immediate objective (yours):** *release certification*, not new feature
development. The product surface is complete. Your job is to prove — on real
credentials, on real devices, with real providers — that it works, and to
fix only reproduced blockers found during that verification.

---

## 2. Current canonical branch and SHA

- **Branch:** `release/little-chapters-v1`
- **Head SHA at handoff:** run `git rev-parse HEAD` on the branch — the last
  commit in this pass is the "V1 final Codex-handoff pass" commit whose SHA
  the operator will share with you.
- Do **NOT** work from `main` unless explicitly instructed. `main` is
  behind the canonical release candidate.
- Do NOT rebase, force-push, or merge this branch during your pass.

To resume:

```bash
git fetch origin
git checkout release/little-chapters-v1
git pull --ff-only origin release/little-chapters-v1
npm install
(cd reading-tutor && npm install)
```

---

## 3. Product architecture

### Public funnel

`/` (landing) → `/setup` (name/age/interests/optional child context) →
`/home` (child) → `/read` (interactive session) → `/parent` (post-session
note). Behind the paywall: `/unlock` → `/register` (Google/Apple, phone
optional) → `/payment` (plan chooser) → Stripe Checkout →
`/payment/success` or `/payment/cancel`. Manage everything: `/settings`.
Trust: `/privacy`, `/terms`, `/support`.

### Parent experience

`/setup` collects name, age, 3 interests, optional child context (up to
2000 chars). `/settings` mirrors those + preferences (music, communication)
+ Manage plan + Delete account. `/parent` shows the after-session note,
Momo, chapter history.

### Child experience

`/home` renders the Play button and Momo. `/read` runs a fully-planned
StoryBlueprint (pages of narrative interleaved with authored interactions:
Find the Sound, Find in Scene, Prediction, Word Builder, Story Order, Final
Story Unlock). Chapter end is a cliffhanger + Momo XP.

### Story system

`lib/story-blueprint.ts` types + validators; `lib/story-generator.server.ts`
generates a complete blueprint (via OpenAI when configured, deterministic
fallback otherwise); `lib/story-interactions.ts` derives an authored
`StoryInteractionManifest`; `lib/session-plan.ts` +
`lib/session-composer.ts` sequence the interactions; `lib/story-session-orchestrator.ts`
drives the runtime session on `/read`.

### Interaction system

`components/*` render the interactive beats; `lib/tutor-intents.ts` supplies
copy; `lib/story-interactions.ts` enumerates the manifest.

### Audio system

`lib/audio-session.ts` is the SINGLE OWNER of tutor speech. Providers:
`lib/audio.ts` (ElevenLabs primary, Web Speech fallback). Cancellation is
generation-counted; theme/ambience ducking during speech is centralized.

### Visual system

`lib/chapter-scenes.ts` requests the generated scene package (`/api/chapters/visuals`)
and caches it; falls back to the approved static manifest
(`lib/scene-manifest.ts`, `lib/scene-selector.ts`). Every `/read` scene is
selected via `sceneUrl(scenePackage, sceneId)` → static fallback →
`.lc-scenic` gradient (never blank).

### Reading / grading

`lib/pronunciation.ts` (Azure Speech), `mdd/` (self-hosted wav2vec2 phoneme
decoder). `lib/reading-verdict.ts` combines both: flag only when BOTH object
(MDD <70 AND Azure min-phoneme <50). `lib/help-ladder.ts` runs the 3-rung
non-blocking correction. `lib/reading-signal-adapter.ts` +
`lib/reading-session-interpreter.ts` bridge to the reading-tutor rules
layer.

### Persistence

- **localStorage first, Firestore best-effort mirror.** See
  `docs/PERSISTENCE.md` for full model.
- Profile: `lib/profile.ts` (local) + `lib/profile-repository.ts` /
  `lib/profile-store-admin.ts` (server mirror via `/api/profile`).
- Preferences: `lib/preferences.ts` + `/api/preferences`.
- Daily chapter: `lib/chapter-store-admin.ts` + `/api/chapters/today`.
- Reading progress + sessions: `lib/child-progress.ts` +
  `lib/progress-store-admin.ts` + `/api/progress/*`.
- Chapter history + report: `lib/chapter-history.ts` + `lib/profile.ts`
  (SessionReport).
- Pet state (Momo): `lib/pet.ts` — per-uid localStorage; Firestore mirror
  deliberately not deployed until rules are scoped.

### Payments

`lib/plans.ts` (client-safe copy) + `lib/stripe.ts` (server-only SDK).
Routes: `/api/payments/checkout`, `/api/payments/verify`,
`/api/payments/subscription`, `/api/payments/portal`,
`/api/payments/webhook`. Entitlement UX gate: `lib/entitlement.ts` +
`lib/use-entitlement.ts` (fail OPEN). Server enforcement:
`lib/entitlement-server.ts` (fail CLOSED). Ownership: `customerBelongsTo`
on every route touching a customer id.

### Analytics

`lib/analytics.ts` client helper (whitelist sanitizer + exactly-once for
conversion events + sendBeacon batching + silent-fail). `/api/analytics/collect`
receiver (allow-list + size cap + structured `lc.analytics` log line to
stdout). Zero third-party SDK. Vercel logs are the V1 dashboard.

### Trust surfaces

Static pages `/privacy`, `/terms`, `/support`. Global footer links
(`app/layout.tsx`). Account deletion: `/api/parents/delete` (see §5).
`/api/health` reports configured/reachable capability booleans.

---

## 4. Frozen V1 invariants

Codex must **NOT** change these without a reproduced blocker documented in
writing.

| Invariant | Enforced by |
|---|---|
| Complete StoryBlueprint generated/planned **before page 1** | `lib/story-blueprint.ts` + `test:story-engine` |
| Meaningful Prediction branches with pre-authored consequences | `PredictionBranch` + `test:story-branch-browser` |
| Story reaches climax + resolution | Blueprint + `test:story-engine` |
| Current game set only (Find Sound, Find in Scene, Prediction, Word Builder, Story Order, Final Story Unlock) — **no new games** | `lib/story-interactions.ts` |
| Grading thresholds untouched | `VERDICT_THRESHOLDS` in `lib/reading-verdict.ts` |
| Dual Azure + MDD grading policy | `combineVerdicts` |
| Verified-visible visual grounding contract, ≥0.6 confidence | `lib/chapter-scenes.ts` |
| Tactile Find-in-Scene fallback when grounding fails | `/read` render + `test:correction` |
| ElevenLabs primary, Web Speech fallback | `lib/audio.ts` |
| Semantic-turn tutor speech (one utterance per intent) | `audio-session.speakSequence` + `test:correction-pass-2` |
| Manage Plan opens Stripe billing portal (never custom card UI) | `/settings` + `/api/payments/portal` |
| Optional `childContext` reaches blueprint generation | `resolveGenerationContext` + `test:story-engine` |
| Phone is OPTIONAL at registration — never required unless SMS chosen | `/register` + `/settings` |
| Analytics allowlist sanitizer drops non-approved properties | `lib/analytics.ts` `sanitize()` + `test:analytics` |
| Ownership checks on every Stripe route (`customerBelongsTo`) | `lib/stripe.ts` |
| Server-side price resolution (client sends `planId`) | `priceIdForPlan` |
| `onIdTokenChanged` (not `onAuthStateChanged`) for auth publish | `components/AuthProvider.tsx` |
| Auth state boxed per publish (fresh `{ user }` per notification) | `AuthProvider.publish` |
| Reading-debug diagnostic route (`/api/reading/debug-verdict`) preserved | `lib/reading-debug.ts` |

---

## 5. Known-solved regressions

Do not reintroduce.

| Problem | Current invariant |
|---|---|
| Interaction background scene was ownership-ambiguous → different beats got wrong scene | `lib/chapter-scenes.ts` + `sceneUrl(package, sceneId)` |
| Repeated single-wallpaper static fallback across every page of a chapter | Per-page `selectSceneForPage` + generated pack when available |
| No generated/static provenance visible | `sceneAssetSources` + `__lcChapterDebug()` + `lib/adventure-debug.ts` |
| Find the Sound spoke child-facing `/sh/` notation | `lib/tutor-intents.ts` sound copy — natural phonemes only |
| Find the Sound needed a tap to start | Auto-model on interaction enter |
| Multi-segment audio arithmetic bug (double-count on interaction re-enter) | `audio-session.speakSequence` exactly-once completion |
| Robotic fragmented sound-example delivery | One semantic turn per intent — `speakSequence` |
| Find in Scene asked about `bag` when no bag was visible | Verified-visible entity metadata ≥0.6 confidence + tactile fallback |
| False claims that story world visually changed | Story-authored `sceneId` per beat + provenance display |
| Malformed Prediction text (`Mike follows the behind.`, `Mike follows the sat.`) | `predictionCaptionIssues` validator + `test:correction-pass-2` explicit assertion |
| Story architecture generated page-shape-by-page-shape (drift over time) | Whole blueprint + branches + reconvergence up-front |
| Manage Plan not reachable from UI | `/settings` Manage Plan → `/api/payments/portal` |
| Missing child free-form context | `ChildProfile.childContext` (optional, ≤2000 chars) reaches blueprint |
| No Privacy / Terms / Support / delete | `/privacy`, `/terms`, `/support`, `/api/parents/delete` + `/settings` Delete-account gate |
| `past_due` silently locked the parent out | `/api/payments/subscription` returns `needsAttention` + `<PaymentAttentionBanner/>` |
| No funnel analytics | 14 funnel + 4 quality events in `lib/analytics.ts`; `test:analytics` proves instrumentation |
| Landing overpromised "20 minutes" as chapter length | Copy changed to "A short daily reading adventure." |
| `/register` claimed SMS as core value | Copy rewritten to account-continuity/membership |
| Phone required to reach `/payment` | Made optional; button gates on `!isAuthenticated` only |

---

## 6. Scope freeze

Codex must NOT add before V1:

- New games (Prediction/FTS/FIS/WordBuilder/StoryOrder are enough)
- Social features, sharing, referrals, invites
- Classroom or teacher features
- Multiplayer / co-reading
- Native iOS/Android app (web + PWA install prompt is enough)
- Multi-child household architecture (single-profile localStorage stays)
- Elaborate parent analytics dashboard (Vercel logs suffice for V1)
- Achievements economy beyond Momo XP
- Sophisticated recommendation systems
- Push notifications (VAPID + cron are documented in `docs/PET_SYSTEM.md`
  as roadmap — do NOT ship without a parental-consent surface first)
- New pricing models, coupons, gifting, tiers
- Grader threshold retuning by feel
- Open-world / free-branching stories
- "Illustration perfection" project — a valid generated pack + curated
  fallback is enough
- Architecture rewrites of any subsystem

---

## 7. Current release gate

| Item | Status |
|---|---|
| Privacy reachable | VERIFIED |
| Terms reachable | VERIFIED |
| Support reachable | VERIFIED |
| Account deletion works | VERIFIED source; UNVERIFIED against live Firebase |
| Manage Plan works | VERIFIED source + `test:v11-browser`; UNVERIFIED live Stripe |
| Payment recovery works | VERIFIED source + banner mounted; UNVERIFIED live `past_due` drill |
| Stripe test-mode lifecycle | **UNVERIFIED — needs credentials** |
| Funnel analytics | VERIFIED (deterministic + live-server probe returned HTTP 204) |
| Quality analytics (tts/story/scoring/visual failed) | VERIFIED wiring at safe error boundaries |
| Health/capability endpoint | VERIFIED |
| Parent personalization | VERIFIED |
| Full story coherent | VERIFIED (deterministic) |
| Prediction A/B | VERIFIED (`test:story-branch-browser`) |
| Story visuals relevant | VERIFIED contract; UNVERIFIED live generated quality |
| Find in Scene truthful | VERIFIED contract |
| Find the Sound natural | VERIFIED contract; UNVERIFIED live ElevenLabs pacing |
| Word Builder | VERIFIED |
| Story Order | VERIFIED |
| Reading/scoring | VERIFIED contract; UNVERIFIED live mic |
| Completion persists | VERIFIED |
| Return session works | VERIFIED |
| Mobile journey | **UNVERIFIED — needs devices** |
| Production/preview env documented | VERIFIED (see §9 below) |

3 items UNVERIFIED. That is what your pass is for.

---

## 8. Remaining live verification work — in order

### A. Preview configuration

Confirm every REQUIRED env from §9 is set in the Vercel preview target for
`release/little-chapters-v1`. Verify by hitting `/api/health` on the
preview — every required capability should report `configured: true`.
Anything red is a preview-config bug, not a code bug.

### B. Stripe TEST MODE

Run a real test customer through the full lifecycle:

1. Monthly subscription creation
2. Yearly subscription creation
3. Monthly → annual switch (from the billing portal)
4. Annual → monthly switch (if portal is configured to allow)
5. Payment-method update (test card `4242 4242 4242 4242` first, then swap)
6. Cancel at period end
7. Immediate cancellation (if enabled in dashboard)
8. Return to Little Chapters — check entitlement refresh
9. Force `past_due` (test card `4000 0000 0000 0341`) — confirm
   `<PaymentAttentionBanner/>` appears on `/home`, `/parent`, `/settings`
10. Update card → confirm banner clears + `subscribed: true` restored

Distinguish **application code bug** vs **Stripe dashboard configuration
bug**. Do NOT change application code to compensate for missing dashboard
settings.

### C. Firebase live

1. Anonymous → set up child → play free chapter
2. Sign in with Google (linkWithPopup path)
3. Verify `parents/{uid}` and `parents/{uid}/children/{childId}` documents
4. Enter childContext in `/settings` → confirm it appears in `/api/profile`
   response
5. Complete a chapter → confirm `parents/{uid}/children/{childId}/sessions`
   receives a document
6. Delete account from `/settings` → confirm:
   - Stripe subscription canceled (if present)
   - `parents/{uid}` tree removed
   - Auth user removed
   - Local storage cleared
   - Return to `/` succeeds
7. Sign up again with the same Google account → confirm fresh state

Do NOT recursively wipe collections outside the `parents/{uid}` tree the
app owns.

### D. OpenAI stories

Generate ≥3 chapters covering:
- stages 1, 3, 5 (or similar spread)
- interests dogs / space / dinosaurs
- one with a substantive `childContext`, one empty

For each assess:
- grammatical correctness
- causal beats
- personalization surfacing
- Prediction A vs B semantic distinctness
- climax + resolution
- no unexplained objects

Record outputs. Do NOT modify the generator based on one subjective
example — a reproducible structural defect is the only reason to touch it.

### E. Images

For the same chapters check the generated scene package:
- Package exists with the expected `sceneId`s
- Assets differ across narratively different beats
- Find-in-Scene targets are actually visible in the rendered scene

Classify each scene A (strongly relevant) / B (sufficiently relevant) /
C (generic decorative) / D (contradictory). Repeated C/D across normal
chapters is a blocker.

### F. ElevenLabs

Real conversational pacing check on `/read`:
- Welcome line is one natural turn
- Find-the-Sound examples are one turn each
- Correction rungs are one turn each
- Duck stays engaged across the whole utterance
- No robotic pauses between semantic fragments
- No duplicate tutor speech

### G. Azure / MDD

Real mic on iPhone/iPad:
- Mic permission works
- Azure token minted
- Dual verdict fires
- MDD-unavailable fallback still lets the child finish
- Help ladder rungs advance correctly

### H. Physical mobile

iPhone Safari, iPad Safari (portrait), Chrome Android if available. Full
journey landing → payment → chapter → completion → settings. Only fix
actual blockers.

---

## 9. Environment requirement matrix

| Capability | Env vars | Category |
|---|---|---|
| Firebase Web (client) | `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` | **REQUIRED FOR V1** |
| Firebase Admin (server) | `FIREBASE_SERVICE_ACCOUNT` (raw JSON or base64) | **REQUIRED FOR V1** |
| Firebase Storage | `FIREBASE_STORAGE_BUCKET` (or `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`) | REQUIRED only if using generated images |
| Stripe secret | `STRIPE_SECRET_KEY` | **REQUIRED FOR V1** |
| Stripe monthly price | `STRIPE_MONTHLY_PRICE_ID` | **REQUIRED FOR V1** |
| Stripe yearly price | `STRIPE_YEARLY_PRICE_ID` | **REQUIRED FOR V1** |
| Stripe webhook secret | `STRIPE_WEBHOOK_SECRET` | **REQUIRED FOR V1** |
| Stripe portal enabled + swap allowed + cancel enabled | dashboard config, not env | **REQUIRED FOR V1** |
| Canonical app URL | `NEXT_PUBLIC_APP_URL` | REQUIRED (used for Stripe return URLs) |
| OpenAI story generation | `OPENAI_API_KEY`, `OPENAI_STORY_MODEL` (default `gpt-4o-mini`) | **REQUIRED FOR V1**; FALLBACK: static demo arc |
| OpenAI image generation | (same key) — image endpoint currently uses the OpenAI text account | REQUIRED for AI images; FALLBACK: curated static scenes |
| ElevenLabs | `ELEVENLABS_API_KEY`, optionally `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID` | **REQUIRED FOR V1**; FALLBACK: Web Speech |
| Voice-provider escape hatch | `NEXT_PUBLIC_VOICE_PROVIDER=web-speech` | OPTIONAL (forces Web Speech) |
| Azure Speech | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | **REQUIRED FOR V1** |
| MDD | `MDD_SERVER_URL` (default `http://127.0.0.1:8010`), `MDD_API_KEY` | REQUIRED for dual-grader; FALLBACK: Azure-only |
| Twilio SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | **OPTIONAL FOR V1** — only used when parent picks SMS in Settings |
| SpeechAce | `SPEECHACE_API_KEY` | OPTIONAL — vendor-comparison scripts only |
| Speech unauth escape | `SPEECH_ALLOW_UNAUTH=1` | DEV ONLY — never set in prod |
| Support email override | `NEXT_PUBLIC_SUPPORT_EMAIL` | OPTIONAL (default `support@littlechapters.com`) |

Verify all REQUIRED via `GET /api/health` on the preview.

---

## 10. Canonical architecture freeze

**Canonical branch:** `release/little-chapters-v1`
**Head SHA at freeze:** the operator will share the exact commit SHA.

**Canonical customer journey:**
landing → setup → optional child context → child home → full interactive
chapter → completion → register → payment → entitlement → return →
parent/settings → billing management.

**Canonical story flow:**
blueprint → complete story → authored interaction manifest → visual plan
→ rendered session → branch selection → consequence → reconvergence →
resolution.

**Canonical interaction flow (session order):**
1. Reading beats (blueprint pages, 1–2 sentences each)
2. Correction ladder on stumbles (help-ladder rungs 1/2/3, non-blocking)
3. Find the Sound — auto-modeled examples → child taps matching story word
4. Find in Scene — story-authored target with verified-visible metadata
   (≥0.6 confidence); tactile-card fallback when grounding is not truthful
5. Prediction — two authored options with pre-authored consequences,
   reconvergence built into the blueprint
6. Word Builder — chunk-audio + joined-word support
7. Story Order — comprehension sequencing
8. Final Story Unlock — celebration/reward beat
9. Chapter end — cliffhanger + Momo XP + parent note

**Canonical audio ownership:**
`lib/audio-session.ts` owns tutor-speech scheduling, cancellation, ducking,
and exactly-once completion. Providers live in `lib/audio.ts` (ElevenLabs
primary → Web Speech fallback). Nothing else calls `speak*()` directly on
the browser API.

**Canonical visual ownership:**
`lib/chapter-scenes.ts` resolves `chapter → scenePackage` (generated where
available, approved-static fallback otherwise). Per-page mapping via
`sceneUrl(scenePackage, sceneId)`; final fallback is the CSS gradient
(`.lc-scenic` / `.lc-cliff`). Never blank.

**Canonical persistence ownership:**
- **Profile:** `lib/profile.ts` (local) + `lib/profile-repository.ts` +
  `/api/profile`
- **Child context:** field on `ChildProfile` — same store as profile
- **Daily chapter:** `lib/chapter-store-admin.ts` + `/api/chapters/today`
  (server-persisted for signed-in parents, local per-day otherwise)
- **Preferences:** `lib/preferences.ts` + `/api/preferences`
- **Completion / session:** `lib/child-progress.ts` +
  `/api/progress/complete-session` (localStorage authoritative;
  Firestore mirror best-effort)
- **History:** `lib/chapter-history.ts` (localStorage)
- **Report (parent note):** `lib/profile.ts` `SessionReport` (localStorage)
- **Entitlement:** UX gate `lib/entitlement.ts` +
  `lib/use-entitlement.ts` (fails open); server enforcement
  `lib/entitlement-server.ts` (fails closed)
- **Pet (Momo):** `lib/pet.ts` — per-uid localStorage

**Canonical commercial flow:**
Stripe Checkout → `/payment/success?session_id=…` → `/api/payments/verify`
writes Firestore + clears entitlement cache → `/home`.
Webhook `/api/payments/webhook` mirrors subscription state updates.
Recovery: `/api/payments/subscription` returns
`{needsAttention, reason}` → `<PaymentAttentionBanner/>` on
`/home`/`/parent`/`/settings` → `/api/payments/portal` → Stripe billing
portal → return to `/payment`.

---

## 11. Evidence rules for Codex

Distinguish, in every claim:

- **VERIFIED** — you exercised it with real inputs and observed the outcome
- **LIKELY** — source + reasoning support it but you did not exercise it
- **UNVERIFIED** — no evidence either way, or the check requires something
  you do not have
- **BROKEN** — you reproduced a defect

Source code alone does **not** verify external providers. Mocked browser
tests do **not** verify:
- provider latency
- provider output quality
- Stripe dashboard settings
- Firebase production rules
- mobile autoplay
- real child microphone input.

Do NOT claim RED/YELLOW/GREEN on strength of source reading alone.

---

## CODEX TASK 1 — V1 LIVE RELEASE CERTIFICATION

> Work only on `release/little-chapters-v1` in `JaymeKame/Little-Chapters`.
> Do NOT merge to `main`. Do NOT production-deploy. Do NOT add features.
> Do NOT modify the story engine, grading thresholds, audio session, or
> visual grounding contract unless you reproduce a P0 blocker (see the
> "Frozen V1 invariants" section of `docs/CODEX_V1_HANDOFF.md`).
>
> ## Bootstrap
>
> 1. `git fetch origin && git checkout release/little-chapters-v1 && git pull --ff-only`
> 2. `npm install && (cd reading-tutor && npm install)`
> 3. Read `docs/CODEX_V1_HANDOFF.md` end to end.
>
> ## Preview environment
>
> 4. Confirm the Vercel preview for this branch has every REQUIRED env from
>    the Environment Requirement Matrix (`docs/CODEX_V1_HANDOFF.md` §9).
>    Verify by hitting `GET /api/health` on the preview host — every
>    REQUIRED capability should return `configured: true`. Any red flag
>    is a preview-config issue, not a code issue.
> 5. Verify Stripe dashboard has (a) monthly and yearly prices matching
>    `STRIPE_MONTHLY_PRICE_ID` / `STRIPE_YEARLY_PRICE_ID`, (b) billing
>    portal enabled with monthly↔yearly swap allowed, (c) cancellation
>    enabled, (d) webhook endpoint pointed at `/api/payments/webhook`
>    with signing secret matching `STRIPE_WEBHOOK_SECRET`.
>
> ## Stripe TEST MODE lifecycle
>
> 6. Using Stripe test cards, run in order and record each outcome:
>    - Monthly subscription creation
>    - Yearly subscription creation
>    - Monthly → annual (via billing portal)
>    - Annual → monthly (via billing portal, if enabled)
>    - Payment-method update
>    - Cancel at period end
>    - Immediate cancellation (if configured)
>    - Return to Little Chapters → confirm entitlement refresh
>    - Force `past_due` (test card `4000 0000 0000 0341`) →
>      confirm `<PaymentAttentionBanner/>` appears on `/home`, `/parent`,
>      and `/settings`
>    - Update card → confirm banner clears and `subscribed: true` restored
>
> For each failure, classify: application code / Stripe dashboard config /
> environment mismatch. Fix only application-code causes.
>
> ## Firebase live
>
> 7. Anonymous → setup child → play free chapter → sign in with Google →
>    confirm profile + preferences mirror written under `parents/{uid}`.
> 8. Enter `childContext` in `/settings` → confirm it round-trips through
>    `/api/profile`.
> 9. Complete a chapter → confirm `parents/{uid}/children/{childId}/sessions`
>    receives a document.
> 10. Delete account from `/settings` (type `DELETE`) → confirm:
>     - Any active Stripe subscription canceled
>     - `parents/{uid}` tree removed
>     - Firebase Auth user removed
>     - `localStorage` `little-chapters*` keys cleared
>     - Route lands on `/`
> 11. Sign up again with the same Google account → confirm fresh state.
>
> ## Provider quality
>
> 12. Generate ≥3 chapters across different stages/interests/context
>     inputs. For each check: grammatical correctness, causal beats,
>     personalization surfacing, Prediction A vs B distinctness before
>     reconvergence, climax + resolution, no unexplained objects. Record
>     the drafts.
> 13. For those chapters inspect the generated scene package. Classify
>     each scene A/B/C/D (see handoff §8.E). Repeated C/D is a blocker.
> 14. Real conversational pacing on ElevenLabs across welcome line,
>     Find-the-Sound, correction rungs. Confirm one-utterance-per-intent,
>     ducking across the whole turn, no duplicate speech.
> 15. Real mic on iPhone/iPad through the reading flow: mic permission,
>     Azure token, dual verdict, MDD-unavailable fallback, help ladder
>     advancement.
>
> ## Browser suites against the preview
>
> 16. With `NEXT_PUBLIC_APP_URL` set to the preview host, run:
>     - `npm run test:analytics`
>     - `npm run test:story-engine`
>     - `npm run test:foundation`
>     - `npm run test:entry`
>     - `npm run test:v11`
>     - `npm run test:experience`
>     - `npm run test:correction`
>     - `npm run test:correction-pass-2`
>     - `npm run test:account-management`
>     - `npm run test:chapter-scenes`
>     - `npm run test:entry-browser`
>     - `npm run test:scene-progression-browser`
>     - `npm run test:find-sound-browser`
>     - `npm run test:story-branch-browser`
>     - `npm run test:v11-browser`
>     - `npm run test:auth-registration`
>     - `npm run test:daily-adventure`
>     - `(cd reading-tutor && npm test)`
>     - `npm run typecheck`
>     - `npm run build`
>
> ## Physical mobile
>
> 17. iPhone Safari, iPad Safari (portrait), Chrome Android if available.
>     Landing → setup → chapter → all interactions → chapter end →
>     register → payment → return → settings → Manage plan → portal.
>     Record any physical-device gap honestly — if you do not have a
>     device, say so; do NOT fake success.
>
> ## Deliverable
>
> 18. Fix only reproduced P0 defects. Commit each fix separately with a
>     brief root-cause note. Do not touch anything outside your reproduced
>     failures. Do not merge to `main`. Do not production-deploy.
> 19. Return the release verdict RED / YELLOW / GREEN with:
>     - the exact SHA you finished at
>     - the release-gate checklist (which items are now VERIFIED vs
>       still UNVERIFIED/BROKEN)
>     - live Stripe/Firebase/OpenAI/ElevenLabs/Azure/MDD/mobile evidence
>     - any P0 or P1 you fixed and why
>     - any remaining P0 you did NOT fix and why
>     - whether we can open the PR into `main` and begin controlled
>       acquisition.
