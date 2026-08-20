# Persistence + progression — how reading sessions and ChildProgress are saved

Follow-up to `docs/HELP_LADDER_INTEGRATION.md`. That work proved one chapter
produces one canonical `SessionReading` in memory. This is where that result
gets saved, and where `ChildProgress` (stage, placement/steady mode, the
rolling accuracy window) actually starts existing and moving.

Two goals only, per the task: persist the completed session safely, and
load/create/update `ChildProgress` via `applySession()`. Tomorrow's
generation is explicitly out of scope — see "Blocker before the next task"
at the end.

## PHASE 1 — Audit: what already existed

- **Auth.** `components/AuthProvider.tsx` signs every visitor in
  anonymously on first load (`signInAnonymously`) — a Firebase `uid` exists
  before any parent ever registers. "Registering" links a real provider
  (Google/Apple) onto that same anonymous user (`linkWithPopup`), which
  **preserves the uid**. Only the fallback path (linking impossible — the
  provider account is already tied to a different Firebase user) mints a
  genuinely new uid, via a plain `signInWithPopup`/redirect; that path
  already had a one-time claim function, `claimPetFromAnonymousUid`, to
  rescue pet state from the abandoned anonymous uid.
- **Server auth gate.** `lib/route-auth.ts`'s `requireReadingUser()` is a
  generic (not actually reading-specific despite the name) fail-closed gate:
  requires and verifies a Firebase ID token via `adminAuth().verifyIdToken()`
  when Admin credentials are configured, allows only local dev or an
  explicit escape hatch otherwise. `/api/messages` inlines the identical
  pattern and additionally rejects anonymous callers — appropriate there
  (SMS needs a real phone number on a real account), not appropriate for
  reading progress (which must already be safely attributable to an
  anonymous uid — see "Migration" below).
- **Existing Firestore collections (current `main`-derived branch):**
  `parents/{uid}` (profile fields, Stripe subscription, phone number),
  `parents/{uid}/messages/{id}` (session-note history, written server-side
  via Admin SDK in `/api/messages`, read client-side in
  `components/ParentMessages.tsx`), `readingPets/{uid}` (Momo's XP/streak,
  client-SDK mirror, **flag-gated off** — see below).
- **No `firestore.rules` file exists anywhere in this repo's history.** The
  shared Firebase project (`inzone-f93e4`) has a pre-existing world-readable
  catch-all rule from an earlier ruleset (CLAUDE.md). `lib/pet.ts`'s own
  comment states the `readingPets` rule was written but **deliberately never
  deployed** because of that catch-all — Firestore grants access if ANY
  matching rule allows it, so a new scoped rule sitting next to an existing
  permissive catch-all does not actually restrict anything.
- **`lib/pet.ts` established the pattern this task follows:** localStorage
  is the always-working store; a Firestore mirror is best-effort, behind a
  `NEXT_PUBLIC_*_SYNC` flag defaulted off; a `claimXFromAnonymousUid(uid,
  anonymousUid)` function moves orphaned local data into a new uid exactly
  once, only into an empty destination, only for the specific "linking
  failed" edge case.
- **PR #5 (`claude/chapter-lifecycle-persistence`, unmerged — reviewed as
  reference only, per the task's instruction not to blindly import it):**
  independently reinvented the identical off-by-default mirror pattern for
  `readingHistory/{uid}/entries`, and — usefully — established that a
  session record keyed by `chapterId` is naturally idempotent ("a duplicate
  call for the same chapter... replaces rather than double-counts"). That
  chapterId-keyed idempotency is the seed of this task's design (see
  "Idempotency" below), reused rather than reinvented.
- **What was only ever in localStorage:** everything about a completed
  reading session (there was no `SessionReading`/`ChildProgress` persistence
  of any kind before this task — `reading-tutor/src/progression.ts` was
  fully built and tested but never called with real data, per
  `docs/INTEGRATION_SPINE.md`).

## Identity decision

**existing auth pattern → proposed child identity → ownership model →
migration/fallback behavior**

- **Existing auth pattern:** every visitor already has a Firebase `uid`
  (anonymous or real) by the time `/read` renders; linking normally
  preserves it; server routes verify ownership via `verifyIdToken()`, never
  a client-supplied value.
- **Proposed child identity:** a stable, opaque `childId` (UUID), generated
  once at `/setup` and stored on `ChildProfile.childId` (`lib/profile.ts`).
  Not the child's name — names collide, are mutable, and were already being
  used as a non-unique localStorage-key fragment elsewhere
  (`lib/chapters.ts`'s `stateKey()`). Existing profiles saved before this
  field existed get one generated and persisted back on next `loadProfile()`
  (a one-line, backward-compatible migration).
- **Ownership model:** the parent's Firebase `uid` (anonymous or real — both
  are first-class Firebase identities) owns
  `parents/{uid}/children/{childId}/...`. Every read/write to the new
  collections is **server-mediated** — new API routes
  (`app/api/progress/child`, `app/api/progress/complete-session`) verify the
  caller's ID token via `requireReadingUser()` and derive `uid` from the
  verified token, never from the request body. `childId` IS caller-supplied
  (in the body/query string), but it only ever partitions data under that
  same verified uid's own subtree — there is no code path where a caller
  can address another uid's data (see the static "ownership derived from
  the verified token" test in `reading-tutor/test/run.ts`). This is a step
  more conservative than `lib/pet.ts`'s existing client-SDK-write pattern,
  deliberately: reading-ability data (tricky/clean words tied to a specific
  child) is more sensitive than pet XP, the exact class of data CLAUDE.md
  already flags special caution for, and going server-mediated sidesteps
  the shared project's catch-all-rule problem entirely (Admin SDK writes
  are not subject to Firestore security rules), rather than reproducing the
  same "rule written, never safely deployable" situation `readingPets` is
  already in.
- **Migration/fallback behavior:** because linking normally **preserves**
  the uid, most parents never trigger a migration at all — data already
  written under the anonymous uid IS the signed-in account's data once
  linked, automatically. Only the "linking failed, new uid" fallback needs
  an explicit one-time claim: `claimChildProgressFromAnonymousUid()` in
  `lib/child-progress.ts`, called alongside the existing
  `claimPetFromAnonymousUid()` from the same two call sites in
  `components/AuthProvider.tsx`. Same invariants as the pet claim:
  non-destructive, only into an empty destination, source removed after.
  LocalStorage remains the always-working primary store throughout; server
  persistence degrades gracefully to local-only when `FIREBASE_SERVICE_ACCOUNT`
  isn't configured (exactly like `/api/speech/token`/`/api/reading/decode`
  already do) — this sandbox has no `.env.local`, so the entire proof in
  this task runs the local-only path; see "Blocker" section for what that
  means for the untested Firestore path.

No genuine blocker surfaced during the audit — proceeded per the task's own
instruction.

## PHASE 2/4 — Persisted shapes

Both derive from John's own `toPersistable()` helpers
(`reading-tutor/src/interpret.ts`, `reading-tutor/src/progression.ts`) —
**not reinvented.** `lib/child-progress.ts` only adds identifying/timestamp
metadata around those helpers' output, never a new field the rules layer
doesn't already permit.

**Persisted session** (`parents/{uid}/children/{childId}/sessions/{chapterId}`):

```ts
{
  // from interpret.ts's toPersistable(SessionReading) — untouched:
  sessionId, stage, trickyWords, cleanWords, countedWords, wasAssistedHeavy,
  // added here — identity/timing metadata only, nothing derived/scored:
  childId, chapterId, startedAt, completedAt,
}
```

No `accuracy` field exists anywhere in this shape — `toPersistable()`
already strips it at the source (`interpret.ts`'s own doc comment: "Call
this before writing to Firestore... requires deliberately bypassing it
rather than merely forgetting"). Verified in tests: `!('accuracy' in
persistedSession)` and a full-string serialization check.

**Persisted progress** (`parents/{uid}/children/{childId}/progress/current`):

```ts
{
  // from progression.ts's toPersistable(ChildProgress) — untouched:
  childId, stage, sessionsCompleted, mode, consecutiveLow, trickyWords,
  _windowInternal, // recentAccuracy, under John's own deliberately-internal name
}
```

## PHASE 3 — Initial ChildProgress

`age` is the only signup signal available (`ChildProfile.age`, from
`/setup`). The mapping is two already-existing, unmodified functions
composed, not new pedagogy:

```
lib/chapters.ts stageForAge(age)        // coarse age -> stage estimate
  -> reading-tutor/src/progression.ts initialStage(estimate)  // one stage
     below that estimate, deliberately (its own doc comment: "the cost of
     starting too easy is one slightly dull evening; the cost of starting
     too hard is a child who decides reading is not for them")
```

`lib/child-progress.ts`'s `defaultProgressFor(childId, ageDerivedEstimate)`
is this composition. Once a `ChildProgress` exists for a child, **it is
never recomputed from age again** — `app/read/page.tsx`'s `stage` constant
now reads `progress?.stage`, falling back to the fresh age estimate only for
the instant before the first load resolves. This is deliberately **not**
threaded into chapter generation (`requestTutorChapter`/`tutorStoryContext`
in `lib/chapters.ts` still derive their own stage from age) — the task's own
"do not... change generator inputs" constraint, and see "Blocker" below for
what that leaves unresolved.

## PHASE 4/5 — Idempotency strategy

One pure decision function, `completeSessionPure()` in
`lib/child-progress.ts`, is the entire mechanism:

```ts
function completeSessionPure({ progress, alreadyCompleted, sessionInput, interventions, previouslyTricky }) {
  const reading = interpretSessionWithIntervention(sessionInput, interventions, undefined, previouslyTricky);
  const persistedSession = /* toPersistable(reading) + identity/timestamp fields */;
  if (alreadyCompleted) return { reading, nextProgress: progress, applied: false, persistedSession };
  const { progress: nextProgress } = applySession(progress, reading);
  return { reading, nextProgress, applied: true, persistedSession };
}
```

`alreadyCompleted` is decided by **existence of a session record keyed by
`chapterId`** — the exact idempotency shape PR #5 already established for
`readingHistory`, reused rather than reinvented. Two call sites implement
the identical check against two different stores, so the guarantee holds
both offline and cross-device:

- **Local** (`completeSessionLocally`): checks a localStorage-backed ledger
  (`little-chapters-sessions:<uid>:<childId>`, one entry per `chapterId`)
  synchronously — correct with zero network dependency, which is also what
  makes it possible to test this deterministically with plain Node scripts
  (see Tests below).
- **Remote** (`completeSessionRemotely`, `lib/progress-store-admin.ts`):
  wraps the identical check in a **Firestore transaction** — reads both the
  session doc and the progress doc, decides `applied` from whether the
  session doc already existed, writes both inside the same transaction. This
  is what makes the guarantee hold under genuine concurrency (two requests
  for the same chapter arriving close together — a double-tap, or a client
  retry racing the original request that actually succeeded) rather than
  just in a single-threaded call sequence.

`app/read/page.tsx`'s `finishChapter()` calls the local path synchronously
(this is what actually gates the `progress`/`reading` values used for the
chapter-end screen and the dev debug summary) and fires the remote mirror
without awaiting it — PHASE 4 explicitly says not to block the chapter-end
screen on the optional downstream write.

**Genuinely exercised, not nominally:** the end-to-end proof (below) walks
the SAME chapter to completion twice in a real browser (a reload between
them, matching a real double-tap/retry more closely than a same-process
double-call would) and confirms `stage`/`sessionsCompleted`/`recentAccuracy`
are byte-identical after both, while the session record itself is safely
re-written. `reading-tutor/test/run.ts` additionally proves the pure
decision function directly (`alreadyCompleted: true` short-circuits even
though the same accuracy would otherwise move the stage) and the local I/O
layer via a real double-call.

## PHASE 6 — Anonymous → authenticated migration

Implemented: the **local** claim (`claimChildProgressFromAnonymousUid`),
wired into both `AuthProvider.tsx` call sites that already call
`claimPetFromAnonymousUid` (the "linking failed, new uid" fallback path).
Tested for the non-merge/empty-destination/idempotent-reclaim invariants.

**Flagged limitation, deliberately not built (PHASE 6's own 20%-effort
cap):** there is no equivalent **remote** (Firestore) migration — if a
parent's anonymous uid already has server-mirrored sessions/progress (only
possible with `FIREBASE_SERVICE_ACCOUNT` configured) and then hits the rare
linking-failed fallback, the remote copies stay under the old anonymous
uid's path. Building this properly means either a Cloud Function, an
Admin-SDK batch migration script triggered from a new authenticated
endpoint, or a delete-and-rewrite across two owner paths with its own
idempotency story — clearly more than a fifth of this task's effort for a
gap that only bites the least-common auth fallback, and whose local data is
never lost (only the cross-device mirror is stale until the new uid starts
producing fresh sessions of its own, which happens automatically). Left
here as an explicit, scoped gap rather than a silent one.

## PHASE 7 — Security boundary

- Ownership is derived exclusively from `requireReadingUser()`'s verified
  `auth.uid` in both new routes and in `lib/progress-store-admin.ts` —
  never from `childId` (which only partitions inside that uid's own
  subtree) or any other client-supplied field. Verified by a static source
  check in `reading-tutor/test/run.ts` (no route/store file reads a
  `body.uid`/`searchParams.get('uid')`-shaped value).
- No Firestore security rule was weakened, and none needed to be written to
  make this correct — Admin SDK writes bypass Firestore rules entirely.
  `firestore.rules` (new, this task) proposes scoped rules for these paths
  anyway, purely as documentation for a possible future client-read
  feature, and is explicitly marked **not deployed**.
- **Flagged, per this task's explicit ask, rather than silently inherited:**
  the shared project's world-readable catch-all (referenced in CLAUDE.md,
  confirmed by the complete absence of any `firestore.rules` file in this
  repo's history) means **every** existing client-SDK Firestore path in this
  app — `parents/{uid}`, `parents/{uid}/messages`, `readingPets/{uid}` (if
  its sync flag were ever flipped on) — has never actually been proven
  scoped by a real, load-tested rule. `parents/{uid}/messages`'s client read
  in `components/ParentMessages.tsx` currently *works* in production, which
  is only possible if either a rule scoped to it already exists outside
  this repo's tracked history, or it is *currently relying on the
  catch-all* — this repo cannot tell which from inside it. That distinction
  matters and should be resolved (by inspecting the live rules in the
  Firebase console, not by guessing) independently of this task.

## Tests

`reading-tutor/test/run.ts`, three new sections (run via `cd reading-tutor
&& npm run test`): "Child progress - new child, initial stage", "Child
progress - completeSessionPure: progression, exclusions, idempotency" (new
child creation, clean-session placement jump, assisted-heavy hold,
reread-heavy hold, bookshelf-reread hold, too-few-words hold, pure-level
idempotency, persisted-shape/no-accuracy checks), "Child progress - Class A
intervention still prevents cleanWords, end to end" (the persistence layer
never regresses the boundary work from `docs/HELP_BOUNDARY_VALIDATION.md`),
"Child progress - localStorage I/O: idempotent completion, reload,
migration" (a genuine double-call through the real local I/O path, a reload
via a fresh `loadLocalProgress()` call, the anonymous-uid claim), and
"Progress API routes - ownership..." (the static verified-uid-only check).
Node has no global `localStorage` without `--experimental-webstorage`; a
minimal in-memory shim is installed at the top of the test file so the I/O
layer — not just the pure functions — is exercised with the real module
code, per this repo's "exercised with plain node scripts" convention.

**Not exercised in this session: the live Firestore/Admin-SDK path.** No
`.env.local` exists in this sandbox (`FIREBASE_SERVICE_ACCOUNT` unset, no
Firestore emulator available, no network to a real GCP project), so
`lib/progress-store-admin.ts`'s transactions were code-reviewed carefully
(mirrors the local pure-function logic field-for-field, wraps the identical
read-decide-write sequence in `runTransaction()`) but never run against
real or emulated Firestore. Both new API routes correctly return `503
ADMIN_NOT_CONFIGURED` in that state (verified: they call the existing
`adminUnconfiguredResponse()` guard first, same as every other API route in
this app), and the app's local-storage path is what the end-to-end proof
below actually demonstrates — consistent with how every other Firestore
mirror in this codebase (`readingPets`, PR #5's `readingHistory`) is
already proven the same way, local-first.

## End-to-end proof (real dev server, real browser, local-storage path)

Three runs, one browser session, via Playwright against `npm run dev`:

1. **Fresh child ("Ada"), one clean chapter.** New `ChildProgress` created
   (`stage: 1` — `stageForAge(6)=2`, `initialStage(2)=1`); clean session
   (accuracy 1.0, well above placement's big-jump threshold) → `stage: 3`,
   `sessionsCompleted: 1`. Console: `[Canonical session] {sentenceCount: 5,
   assistedSentenceCount: 0, ..., excludedFromProgression: false}`. No
   `accuracy` field anywhere in the persisted session record.
2. **Reload `/read`, complete the identical chapter again** (same
   profile+day ⇒ same `chapterId` — the real double-tap/retry shape, not a
   synthetic re-call). Progress after: **byte-identical** to step 1
   (`stage: 3`, `sessionsCompleted: 1`, `recentAccuracy: [1]`) — progression
   did not apply twice. The session record itself was safely re-written
   with a fresh `sessionId`/timestamps.
3. **A third `/read` load, no new reading.** Progress restored from storage
   exactly matches steps 1-2 — reload correctly restores state.
4. **A different child ("Ben"), forced through rung 3 on every page**
   (assisted-heavy). Console: `assistedSentenceCount: 5,
   excludedFromProgression: true`; persisted session:
   `wasAssistedHeavy: true, countedWords: 0`; progress: `stage` stayed at
   its initial `1` (unmoved) while `sessionsCompleted` still advanced to
   `1` (a night still happened; it just didn't move the stage — matches
   `applySession()`'s own unconditional-increment behavior, unmodified).

No `accuracy` value appeared in console output, localStorage, or any
persisted record at any point in this proof.

## Blocker before the next task (adaptive next-chapter generation)

`ChildProgress.stage` is now authoritative for the *session/progression*
side of `/read` (`SessionInput.stage`, the help-ladder's phoneme cue), but
`lib/chapters.ts`'s `requestTutorChapter()`/`tutorStoryContext()` still
independently derive their own stage fresh from `profile.age` for
*generation* — untouched here per the explicit "do not... change generator
inputs" constraint. That means a child whose progress has moved (up or
down) from their age-derived starting point is, right now, still being
generated a chapter at their **original** age-derived stage, not their
current one. Reconciling those two — feeding `ChildProgress.stage` into
generation instead of `stageForAge(profile.age)` — is exactly the surface
the next task (adaptive generation) needs to land on; it was left alone
here deliberately, not overlooked.
