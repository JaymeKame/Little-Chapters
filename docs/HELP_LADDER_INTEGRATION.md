# Wiring the real help ladder + per-chapter session accumulation

Trace of `/read`'s state machine done before writing any code, per the task's
own instruction. Implementation follows this document; deviations from it are
called out at the bottom of each section, not silently made.

## 1. Current behavior → required ladder behavior → state changes → risks

### Correction / help

**Current behavior.** `Phase` is `'ready' | 'listening' | 'scoring' |
'correction' | 'celebrate' | 'chapter-end'`. A page take that produces any
`needsHelp` word (via the untouched `combineVerdicts()`) sets `tricky` to the
first flagged word and `phase = 'correction'`, gated by a single ref,
`attemptRef` (0 or 1). The correction card always shows the literal word plus
a hardcoded line ("Let's try that word together."), with two buttons: 🎙️ Try
the word (re-listens on just that word via `beginListening(tricky)`) and Keep
going → (skips immediately, no assist bookkeeping since none existed). A
**second** flagged result — from the retry, or from silence during the retry
— is never re-examined: `handleVerdicts`'s escalation branch is gated on
`attemptRef.current === 0`, so once `attemptRef` is 1, ANY result (including
an all-Omission "child said nothing" result) falls through to
`celebrateAndAdvance()` and is praised. There is one rung, not three, and a
silent retry take is (wrongly) treated as success.

**Required ladder behavior.** Three rungs, sourced from
`reading-tutor/content/config.json help_template.rungs`: rung 1 (phoneme
cue, text only), rung 2 (reveal the word, spoken via TTS, one more attempt),
rung 3 (TTS reads the whole sentence, sentence marked `assisted: true`,
story continues immediately — "no pause, no second chance, no change in
tone"). A child only ever descends the ladder (`max_retries: 2` = two failed
retries, rung 1's and rung 2's, before rung 3). Silence must escalate the
ladder exactly like a mispronunciation, not fall through as a success.

**Exact state changes needed.**
- Replace `attemptRef` (0|1, "have we retried once") with `rungRef`
  (0|1|2|3, "which rung is active for the current word/sentence") plus a
  mirrored `rung` state for render decisions. `Phase` itself is unchanged —
  `'correction'` remains the umbrella phase for all three rungs; `rung`
  differentiates behavior inside it. This is the smallest extension that
  can represent three rungs without redesigning the phase machine.
- `handleVerdicts`'s escalation branch drops the `=== 0` gate: **any**
  flagged result while `rungRef.current < 3` escalates one rung, regardless
  of which rung is already active. This is what fixes the silent-retry bug
  above — a silent retry produces an all-Omission result, which
  `combineVerdicts()` already flags (`reason: 'omitted'`), so it now
  escalates instead of silently celebrating. No new "silence path" is
  added; silence already produces a normal flagged result today, it was
  just being ignored past the first rung.
- New `enterOrEscalateLadder(word)`: increments the rung, sets `tricky`,
  and for rung 2/3 plays the rung's line via the existing `speakPrompt()` /
  `speaking` state — which already drives `duckAmbience()`/
  `restoreAmbience()` (see below), so no new ducking wiring is needed. Rung
  3 additionally sets a new `pageAssistedRef` flag and, on TTS completion,
  calls the existing `celebrateAndAdvance(line, /* cue */ false)` — the
  same no-fanfare advance path the existing "Keep going →" skip already
  uses, which is exactly "no change in tone."
- Rung 1 shows only the config line (phoneme cue), not the literal word —
  matching "gives: phoneme", not "gives: word". Today's card always shows
  the literal word regardless of rung; that has to change so rung 1 doesn't
  give away the answer rung 2 is supposed to reveal.
- Rung 3 shows the normal page text (reusing the existing `<PageText>`
  component, not the tricky-word card) while TTS reads it — the whole
  sentence is being read, not a single word, so the existing "reading" view
  is the right one to reuse, not the correction card.
- The header 🔊/🔇 replay button gets disabled during `phase === 'correction'`
  (previously only during listening/scoring). Reason under Risks below.

**Risks.**
- *TTS/mic overlap.* CLAUDE.md: "TTS must never run while the microphone is
  active." Rung 2/3 TTS only ever starts from `enterOrEscalateLadder`, which
  only runs after a take has finished scoring (mic already released) — no
  live overlap. But the header replay button can independently call
  `speakPrompt()`/`stopSpeaking()` at any time `phase !== 'listening' |
  'scoring'`; without a guard it could `cancel()` a ladder-driven utterance
  mid-flight, which fires that utterance's own `onend`/`onerror` (both wired
  to the same completion handler in `speakPrompt`) at the same time the
  header button also flips `speaking` to `false` directly — two writers to
  the same state on one cancel. Mitigated by disabling the header button
  during `'correction'` (ladder audio is the only thing that should be
  playing then).
- *Double-counting a page's measurement.* Rung 1/2 retries re-listen to only
  the flagged **word**, not the whole page — their `WordScore[]` must never
  overwrite the whole-page measurement already captured on the first take,
  or the accumulated `SentenceResult.words` would silently narrow from "the
  whole page" to "just the one retried word." Guarded by only capturing
  page-level signals when `rungRef.current === 0` at the top of
  `handleVerdicts` (see §2) — true only for the very first, whole-page take.
- *Not a new scoring system.* Nothing above touches `combineVerdicts()`,
  `VERDICT_THRESHOLDS`, `interpret.ts`, or `DEFAULT_INTERPRET_CONFIG`. The
  ladder decides *presentation*, not verdicts — the live "does this word
  need help" signal is exactly what it already was.

### Silence specifically

**Current behavior.** A silent take (nothing recognized) already flows
through the *normal* scoring pipeline — `aggregate()` with zero recognized
words produces an all-`Omission` `WordScore[]`, `combineVerdicts()` flags
every omitted word (`reason: 'omitted'`) — so it already reaches
`handleVerdicts` as a normal flagged result, not a special case. The one
place silence WAS treated ad hoc was the retry-take bug above (silence during
a retry falling through to celebration because of the `attemptRef === 0`
gate) — that is the "separate ad hoc path" the task means, not the initial
per-page silence handling, which was already correctly unified. A true
*connection failure* (`session.stop()` throwing because the socket died with
zero segments) is a distinct, genuine infrastructure error — unrelated to
whether the child spoke — and correctly stays its own recovery path (reset to
`'ready'`, show a connection message); folding a real network failure into
the pedagogical ladder would misrepresent an infra problem as a reading
problem.

**Required behavior.** Already satisfied once the `attemptRef === 0` gate is
removed (§ above) — no separate change needed.

## 2. Session accumulation

**Granularity decision (already made in `docs/INTEGRATION_SPINE.md`, not
re-litigated here): one page = one `SentenceResult`.** The live app's actual
capture granularity is per page (one Azure take per `beginListening` call);
`scripts/run-one-reading-session.ts` already established this precedent.

**What gets captured, and when:**
- On the **first** (`rungRef.current === 0`) scoring result for a page — the
  only take that covers the *whole* page's reference text — the real
  adapter (`toWordSignals()` from `lib/reading-signal-adapter.ts`) is called
  once on that take's `WordScore[]`/`DecodeResult`, and its `signals`/
  `interventions` are stashed in refs. Rung 1/2 retries (word-scoped takes)
  never re-run this — see the double-counting risk above.
- `pageAssistedRef`/`pageRereadRef` track this page's `assisted`/`reread`
  flags, set by the ladder (rung 3, or the skip button) and by the replay
  button respectively (see below).
- When the page is finalized in `advance()`, a `SentenceResult` is pushed —
  `index: pageIdx, text: page.text, words: <stashed signals>, assisted,
  reread` — onto a session-lifetime `sentenceResultsRef`, and the stashed
  `interventions` array onto a parallel `interventionsRef`, then everything
  resets for the next page.
- At `finishChapter()`, one `SessionInput` is assembled from the accumulated
  sentences and run through `interpretSessionWithIntervention()` — the
  **only** interpretation entry point used, per the task's constraint.
  Nothing is persisted, no `applySession()`, no stage change, no
  generation trigger — the function's result is only used for a dev-only
  console summary (sentence/assisted counts, tricky/clean words,
  `excludedFromProgression` — never accuracy or any score).

**Two small, explicit interpretive calls, made here rather than left
implicit:**
- **The "Keep going →" skip button also marks the sentence `assisted:
  true`.** It only ever appears while the ladder is active (`tricky` set),
  meaning the flagged word was neither read correctly nor read to the
  child — John's contract has no "we don't know" verdict, and "assisted"
  (excluded, not judged) is the honest bucket for that, not "correct" and
  not "stumbled."
- **The header 🔊 replay button sets `reread: true` for the page**, when
  used while `tricky` is null (i.e., replaying the *page's* text, not a
  ladder word cue) — this is the one place the existing product already
  "just fed the child these words" outside of rung 3, so it is the natural
  home for the optional-reread flag config's rung-3 note explicitly rules
  out adding *inside* the ladder itself ("no pause, no second chance").

## Files this touches

`app/read/page.tsx` (state machine + accumulation), `lib/help-ladder.ts`
(new — config-driven copy/phoneme lookup, no judgment), `lib/chapters.ts`
(export the already-existing `stageForAge`, no behavior change). Untouched:
`lib/reading-verdict.ts`, `lib/pronunciation.ts`, `reading-tutor/src/*`,
`lib/reading-signal-adapter.ts`, `lib/reading-session-interpreter.ts`.
