# Momo the reading pet

A companion that makes daily reading sticky: Momo hatches from an egg and
grows as the child reads, celebrates good takes, tracks a daily goal and
streak, and greets the child differently depending on how long they've been
away.

## Pieces

| Piece | File | Notes |
|---|---|---|
| Game logic | `lib/pet.ts` | Pure functions: XP awards, level curve (100 + 50·level per level), growth stages (🥚→🐣→🐥→🦉→🦉⭐→🦉👑), local-calendar streaks, greeting/reaction copy. |
| UI + hook | `components/PetCompanion.tsx` | `usePet(uid)` owns state and exposes `awardReading()`; the card renders stage, speech bubble, XP bar, 🔥 streak, daily-goal dots. Self-contained for the future redesign. |
| Wiring | `app/reading/page.tsx` | XP awarded exactly once per scored take, when verdicts land (`finish()` in `runDecode`). Flagged words reduce the award but never zero it — struggling readers always earn. Dev builds get `sim: good` / `sim: tricky` buttons to exercise the flow without a mic. |
| Persistence | `lib/pet.ts` + `firestore.rules` | localStorage always, **scoped per uid** so siblings on a shared device each keep their own pet; mirrored to Firestore `readingPets/{uid}` (owner-only *write* rule added, **not deployed yet**). Newer `updatedAt` wins across devices. ⚠ Privacy: under the current phase-2a rules the temporary read catch-all makes any deployed collection world-readable — since this is kids' data, deploy the readingPets rule together with (or after) phase 2b, not before. |

## XP rules (tuned for encouragement, not accuracy-maximizing)

- +10 per completed reading (floor — a rough reading still feeds Momo)
- +1 per un-flagged word (capped +15, so real passages beat grinding one word)
- accuracy ≥90 → +10, ≥75 → +5
- perfect take (no flags, ≥85 accuracy, ≥3 words) → +15, capped at 60 total

## "Come back" reminders — current state and the follow-up

Today Momo reminds **in-app**: goal-countdown messages while reading, and
absence-aware greetings on return ("Welcome back! Day N of our streak" →
"I missed you SO much! 🥺" after 4+ days). The streak display breaks the day
after a missed day, which is the nudge mechanic.

True away-reminders (push notifications while the app is closed) are a
deliberate follow-up, not built yet. The app is already a PWA, so the path
is: VAPID keypair (env) → push-subscription opt-in UI (parental, not
kid-facing) → subscriptions stored per user → a daily Vercel cron route that
pushes "Momo misses you!" to users whose `lastActiveDay` is yesterday or
older → a push handler in the service worker (next-pwa `customWorkerDir`).
Decide consent/COPPA posture with a parent-facing settings screen first.
