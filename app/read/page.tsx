'use client';

/* Screen 4 — Reading experience (core screen) + Screen 5 — Chapter end.
 *
 * Mockup rules honored here:
 *  - Only one or two sentences at a time; focus words highlighted.
 *  - "I'm listening..." waveform while the child reads; reading auto-stops
 *    after a natural silence (no button-hunting for a 5-year-old).
 *  - Correction state: "Let's try that word together." — gentle blue
 *    support. Never red. Never blocks: one retry, then the story goes on.
 *  - Chapter end: no summary, no scores — just the cliffhanger and a reason
 *    to return. XP quietly feeds Momo; the parent gets the detail instead.  */

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { usePet } from '@/components/PetCompanion';
import { SceneBackground } from '@/components/SceneBackground';
import { SlideWordHelp } from '@/components/SlideWordHelp';
import { AudioWordHelp } from '@/components/AudioWordHelp';
import { SpeakerIcon } from '@/components/icons/SpeakerIcon';
import { MicIcon } from '@/components/icons/MicIcon';
import { QuietCheckIcon } from '@/components/icons/QuietCheckIcon';
import { chapterFor, latestChapterGenerationFailure, requestTutorChapter, stageForAge, type Chapter } from '@/lib/chapters';
import { selectSceneForPage } from '@/lib/scene-selector';
import { appendChapterHistoryEntry } from '@/lib/chapter-history';
import { useEntitlement } from '@/lib/use-entitlement';
import { createLiveProgress, type LiveProgress } from '@/lib/live-progress';
import { loadProfile, loadReport, saveReport, type ChildProfile } from '@/lib/profile';
import { buildSessionPlan, claimEndingCompletion, interactionAfterPage, type SessionBeat } from '@/lib/session-plan';
import { type ReadingAssessmentResult, type ReadingSession } from '@/lib/pronunciation';
import { combineVerdicts, isPhraseUnreliable, type DecodeResult, type WordVerdict } from '@/lib/reading-verdict';
import { buildReadingDebugPayload, readingDebugEnabled } from '@/lib/reading-debug';
import { toWordSignals } from '@/lib/reading-signal-adapter';
import type { SessionIntervention } from '@/lib/reading-session-interpreter';
import { HELP_LADDER, rungLine, phraseRetryLine, pickEncouragement, canTeachWithSlider } from '@/lib/help-ladder';
import {
  defaultProgressFor,
  loadLocalProgress,
  completeSessionLocally,
  fetchRemoteProgress,
  completeSessionRemote,
  reconcileProgress,
} from '@/lib/child-progress';
import type { ChildProgress, SentenceResult, SessionInput, WordSignal } from '@/reading-tutor/src/types';
import { themeAssetFor } from '@/lib/audio';
import { audioSession } from '@/lib/audio-session';
import { AdventureTelemetry, chapterDebugSnapshot, installChapterDebug } from '@/lib/adventure-debug';
import { loadPreferences } from '@/lib/preferences';
import { resolveStoryInteractionManifest } from '@/lib/story-interactions';
import { prepareStoryBeat } from '@/lib/story-session-orchestrator';
import { loadChapterScenePackage, requestChapterScenePackage, sceneUrl, type ChapterScenePackage } from '@/lib/chapter-scenes';

type Phase = 'ready' | 'listening' | 'scoring' | 'correction' | 'celebrate' | 'chapter-end';

/* Live karaoke highlight: SHELVED for now — Azure partials trail real speech
 * by up to a second, which reads as lag rather than magic. The matcher still
 * runs headlessly (it powers the finished-page fast-stop below); flip this to
 * true to bring the visuals and the `sim: live` button back. */
const LIVE_HIGHLIGHT = false;

/* Graded praise for the celebrate beat — always warm, never a failure state;
 * only the intensity tracks the result. */
const PRAISE = {
  top: ['Awesome!', 'Amazing!', 'Fantastic!'],
  great: ['Great job!', 'Great reading!'],
  good: ['Good reading!', 'Nice work!'],
} as const;

const pick = (arr: readonly string[]) => arr[Math.floor(Math.random() * arr.length)];

function praiseFor(accuracy: number, flaggedCount: number): string {
  if (flaggedCount === 0 && accuracy >= 90) return pick(PRAISE.top);
  if (flaggedCount === 0 && accuracy >= 75) return pick(PRAISE.great);
  return pick(PRAISE.good);
}

/* Stage-1-decodable words (only a, i, m, s, f, p, t, n, d — every stage's
 * cumulative grapheme set is a superset of stage 1's) — a last-resort
 * fallback for the ?slideDemo query param below when neither the requested
 * word nor anything on the current page happens to segment. Guaranteed to
 * pass segmentWord() at any real stage, so this never silently no-ops. */
const DEMO_FALLBACK_WORDS = ['sit', 'tap', 'mad', 'sad', 'pin'];

/** Picks a real, currently-segmentable word to force into the help ladder
 *  for the ?slideDemo debug/test path — never invents a word outside the
 *  chapter's own text unless nothing on the page segments at all. Prefers
 *  (1) the requested word if given and valid, (2) the current page's own
 *  focus words, (3) any other word on the current page, (4) the guaranteed
 *  stage-1 fallback list. */
function pickDemoWord(requested: string | null, page: { text: string; focusWords: string[] }, stage: number): string | null {
  const candidates: string[] = [
    ...(requested ? [requested] : []),
    ...page.focusWords,
    ...page.text.split(/\s+/).map((w) => w.replace(/[^a-zA-Z']/g, '')),
    ...DEMO_FALLBACK_WORDS,
  ];
  for (const w of candidates) {
    if (w && canTeachWithSlider(w, stage)) return w;
  }
  return null;
}

/* Scene background: lib/scene-selector.ts's selectSceneForPage() against the
 * real curated manifest (lib/scene-manifest.ts) → .lc-scenic/.lc-cliff
 * gradient if a chosen asset ever 404s. Unlike Home (which shows the
 * chapter's page-0 opening scene as a single cover image), this runs PER
 * PAGE — see this file's sceneSelection useMemo below — so the art
 * progresses through the chapter instead of freezing on one image. A durable
 * generated scene package takes precedence when configured; this selector is
 * the approved-static fallback. */

/* Mandatory calm listening animation: 6 small organic bars gently changing
 * scaleY (~900ms cycle) — no waveform, no neon, no frantic movement. */
function ListenBars({ active }: { active: boolean }) {
  return (
    <span className="lc-listen-bars" aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          style={{
            animationDelay: `${i * 110}ms`,
            animationPlayState: active ? 'running' : 'paused',
            opacity: active ? 1 : 0.4,
          }}
        />
      ))}
    </span>
  );
}

/** Handoff spec: one sentence per line with breathing room; every focus word
 *  bold in the accessible reading blue (#075DAD).
 *
 *  While the mic is live, words light up karaoke-style as the child reads
 *  them: unread words sit dimmed, heard words return to full strength, and
 *  the most recent one glows sunshine. Lighting tracks position, never
 *  correctness — a misread word still lights when the child moves on.       */
function PageText({
  text,
  focusWords,
  live = false,
  readCount = 0,
}: {
  text: string;
  focusWords: string[];
  live?: boolean;
  readCount?: number;
}) {
  const lower = focusWords.map((w) => w.toLowerCase());
  const sentences = text.split(/(?<=[.!?])\s+/);
  let wordIdx = 0;
  return (
    <p className="lc-page-text">
      {sentences.map((sentence, si) => (
        <span key={si} className="lc-sentence">
          {sentence.split(/(\s+)/).map((tok, i) => {
            // Word-counting MUST stay in lockstep with lib/live-progress.ts
            // (fold curly apostrophes, keep digits) or the highlight drifts.
            const clean = tok.replace(/[’ʼ]/g, "'").toLowerCase().replace(/[^a-z0-9']/g, '');
            if (!clean) return <span key={i}>{tok}</span>;
            const idx = wordIdx++;
            const cls = [
              'lc-word',
              lower.includes(clean) ? 'lc-focus-word' : '',
              // Strictly greater: the word the child is decoding RIGHT NOW
              // (idx === readCount) stays at full strength — the highlight
              // trails recognition, so dimming it would dim the very word
              // being read.
              live && idx > readCount ? 'lc-word-dim' : '',
              live && idx === readCount - 1 ? 'lc-word-now' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <span key={i} className={cls}>
                {tok}
              </span>
            );
          })}
        </span>
      ))}
    </p>
  );
}

function SessionProgress({ current, total }: { current: number; total: number }) {
  return <div className="lc-session-progress" aria-label={`Part ${current + 1} of ${total}`}>{Array.from({ length: total }, (_, index) => <span key={index} className={index <= current ? 'is-done' : ''} />)}</div>;
}

export default function ReadPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const pet = usePet(authLoading ? undefined : (user?.uid ?? null));
  const [profile, setProfile] = useState<ChildProfile | null>(null);
  const [progress, setProgress] = useState<ChildProgress | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [scenePackage, setScenePackage] = useState<ChapterScenePackage | null>(null);
  const [introOpen, setIntroOpen] = useState(() => typeof window === 'undefined' || new URLSearchParams(window.location.search).get('skipWelcome') !== '1');
  const [activeInteraction, setActiveInteraction] = useState<Extract<SessionBeat, { kind: 'sound-hunt' | 'prediction' | 'word-builder' }> | null>(null);
  const [interactionChoice, setInteractionChoice] = useState<string | null>(null);
  const [interactionFeedback, setInteractionFeedback] = useState<'idle' | 'try-again' | 'success'>('idle');
  const [wordBuilderProgress, setWordBuilderProgress] = useState(0);
  const [pendingNextPage, setPendingNextPage] = useState<number | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('ready');
  // Flips true after a few seconds of 'scoring' — an MDD cold start (Cloud
  // Run scale-from-zero) can leave grading genuinely slow well past what
  // "One moment…" implies. The spinner never stops either way (it always
  // loops), but swapping to a second, still-warm, still-jargon-free line
  // tells the child time passing is expected, not a freeze — see
  // docs/DECODING_GRADER.md's Cold-start latency section for why this can
  // take a while on the very first reading of a session.
  const [scoringSlow, setScoringSlow] = useState(false);
  const [tricky, setTricky] = useState<string | null>(null); // correction-state word
  const [error, setError] = useState<string | null>(null);
  const [readCount, setReadCount] = useState(0); // live karaoke highlight cursor
  const [praise, setPraise] = useState('Great reading!');
  const [speaking, setSpeaking] = useState(false); // TTS replay of the current sentence — distinct from mic-listening
  const [sentenceLeaving, setSentenceLeaving] = useState(false); // brief out-transition before the next sentence mounts
  const [rung, setRung] = useState<0 | 1 | 2 | 3>(0); // help-ladder rung for the current `tricky` word (0 = not in the ladder)
  // Gates the mic-retry button while EITHER help interaction (slide-through
  // for a segmentable word, or AudioWordHelp's listen-then-your-turn for one
  // that isn't) is still in progress: false the moment a new tricky word
  // enters the ladder, true only once the child has finished that help step
  // — sliding/listening must visibly come before retrying aloud.
  const [helpDone, setHelpDone] = useState(false);
  // Which visual the current 'celebrate' phase gets: a real independent/
  // retry success (star + sparkles + word glow) vs. an assisted rung-3
  // continuation (quiet, warm, no fanfare) — see celebrateAndAdvance's `cue`
  // param. Neither should ever read as failure; only the former is a
  // celebration.
  const [celebrateCue, setCelebrateCue] = useState(true);
  const liveRef = useRef<LiveProgress | null>(null);
  const listeningCuePlayedRef = useRef(false);
  const sessionRef = useRef<ReadingSession | null>(null);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rungRef = useRef<0 | 1 | 2 | 3>(0); // logic source of truth; `rung` state above mirrors it for render
  const awardedRef = useRef(false); // XP granted for the CURRENT page (survives retry-take errors)
  const finishChapterRef = useRef(false);
  const finalUnlockPromptedRef = useRef(false);
  const practicedRef = useRef<Map<string, string>>(new Map());
  // Words the FIRST whole-page take flagged, beyond the one currently in the
  // ladder — a retry take only re-listens to the single word it targets, so
  // without this queue every flagged word after the first would never get a
  // correction pass at all (see finishWordOrContinue below).
  const pendingFlaggedRef = useRef<string[]>([]);
  // How many phrase-level retries (see handlePhraseFailure below) THIS page
  // has already used. Resets with every other per-page ref in advance().
  const phraseRetryRef = useRef(0);
  const startedReadingRef = useRef(false); // once true, never swap the chapter text
  const disposedRef = useRef(false);
  const adventureTelemetryRef = useRef(new AdventureTelemetry());
  const lastCountedPageRef = useRef(-1);
  const lastCountedInteractionRef = useRef<string | null>(null);
  const lastTelemetryPhaseRef = useRef<Phase | null>(null);

  /* Paywall. /home already routes a locked tap to /unlock, so this only
   * catches a deep link, a back-button return, or a refresh mid-flow. It
   * never interrupts a chapter in progress (startedReadingRef) — a child
   * whose subscription lapses between page one and page five finishes the
   * story, and the gate applies to the next one. */
  const { locked: chapterLocked, subscribed, signedIn } = useEntitlement(chapter?.id ?? null);
  useEffect(() => {
    // `chapter &&` matters: with no chapter yet there is no id to recognise
    // as already-owned, so a free chapter being RE-read would look locked.
    if (chapter && chapterLocked && !startedReadingRef.current) router.replace('/unlock');
  }, [chapter, chapterLocked, router]);

  // --- Canonical session accumulation (reading-tutor's rules layer) ---
  // One page == one SentenceResult (see docs/INTEGRATION_SPINE.md — this is
  // the live app's actual per-take capture granularity, already established
  // there, not re-decided here).
  //
  // stage: once a ChildProgress exists, ITS stage is authoritative (PHASE 3
  // of docs/PERSISTENCE.md) — stageForAge(profile.age) is used only as the
  // one-time seed for a brand-new child's initial progress, and as a brief
  // fallback for the instant before that first load resolves. This is
  // deliberately NOT threaded into chapter generation (requestTutorChapter
  // below still derives its own stage from age) — that reconciliation is
  // explicitly out of scope here (see docs/PERSISTENCE.md's final section).
  const stage = progress?.stage ?? (profile ? stageForAge(profile.age) : 1);
  const sessionIdRef = useRef<string>('');
  const startedAtRef = useRef<string>('');
  const sentenceResultsRef = useRef<SentenceResult[]>([]);
  const interventionsRef = useRef<SessionIntervention>([]);
  // The CURRENT page's canonical measurement, captured once from the first
  // (whole-page) take only — rung 1/2 retries re-listen to just the
  // flagged word and must never overwrite this (see docs/HELP_LADDER_INTEGRATION.md).
  const pageSignalsRef = useRef<WordSignal[] | null>(null);
  const pageInterventionsRef = useRef<boolean[] | null>(null);
  const pageAssistedRef = useRef(false);
  const pageRereadRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    const p = loadProfile();
    if (!p) {
      router.replace('/');
      return;
    }
    setProfile(p);
    setChapter(chapterFor(p.interests[0], p.childName));
    sessionIdRef.current = `${p.childName}-${Date.now()}`;
    startedAtRef.current = new Date().toISOString();
    sentenceResultsRef.current = [];
    interventionsRef.current = [];
    return () => {
      disposedRef.current = true;
      sessionRef.current?.cancel();
      sessionRef.current = null;
      audioSession.cancelAll();
      audioSession.stopTheme();
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
    };
  }, [router]);

  /* Deterministic test path for the slide-through help interaction:
   * /read?slideDemo forces a real, currently-segmentable word straight into
   * the ladder via the SAME enterOrEscalateLadder() a genuine stumble uses —
   * this is not a mock UI, it exercises the real rung/verdict/audio machinery
   * with a chosen word instead of a real mic take. Deliberately NOT gated on
   * NODE_ENV: Vercel preview deployments are production builds (the existing
   * `sim: *` dev buttons never render there at all), and forcing a practice
   * word into a pre-launch reading app carries no real risk, so this stays
   * reachable on the preview for manual testing. Fires at most once per page
   * load, and never while a real ladder interaction is already in progress. */
  const slideDemoFiredRef = useRef(false);
  useEffect(() => {
    if (slideDemoFiredRef.current || !chapter || tricky) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('slideDemo')) return;
    const requested = params.get('slideDemo');
    const currentPage = chapter.pages[pageIdx];
    if (!currentPage) return;
    const word = pickDemoWord(requested && requested !== '1' && requested !== 'true' ? requested : null, currentPage, stage);
    if (!word) return;
    slideDemoFiredRef.current = true;
    enterOrEscalateLadder(word);
  }, [chapter, pageIdx, tricky, stage]);

  /* Test-only: /read?fixtureTake=word:accuracy:errorType,word:accuracy,...
   * drives a real, arbitrary take through combineVerdicts()+handleVerdicts()
   * — see simulateFixture below. Unlike ?slideDemo, this IS gated on
   * NODE_ENV: it can inject any word/error combination (including more than
   * one flagged word at once), which is a materially bigger surface than
   * slideDemo's single-word picker, and has no reason to be reachable
   * outside local/CI test runs. Fires at most once per page load. */
  const fixtureTakeFiredRef = useRef(false);
  // The parsed ?fixtureTake words, kept around so the dev-only "sim: repeat
  // fixture" button (rendered only once a fixtureTake has actually fired —
  // see the ready-phase dev button block below) can re-submit the SAME take
  // again without a real mic — the only way to deterministically drive
  // handlePhraseFailure's retry-then-exhaust cycle in a test. Not read by
  // anything else; purely a test aid, same NODE_ENV gate as the effect below.
  const fixtureTakeWordsRef = useRef<{ word: string; accuracy: number; errorType?: string }[] | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if (fixtureTakeFiredRef.current || !chapter) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('fixtureTake');
    if (!raw) return;
    const words = raw.split(',').map((tok) => {
      const [word, accStr, errorType] = tok.split(':');
      return { word, accuracy: Number(accStr ?? '30'), errorType };
    });
    if (words.some((w) => !w.word)) return;
    // Test-only: pre-seeds the phrase-retry counter so a single fixture take
    // can exercise handlePhraseFailure's EXHAUSTED branch directly. Driving
    // that branch for real requires HELP_LADDER.max_retries consecutive
    // catastrophic takes, each of which normally re-opens a real mic session
    // in between (handlePhraseFailure's own retry path) — not reachable
    // without live Azure credentials in a headless test run.
    const seedRetries = Number(params.get('fixturePhraseRetries') ?? '0');
    if (seedRetries > 0) phraseRetryRef.current = seedRetries;
    fixtureTakeFiredRef.current = true;
    fixtureTakeWordsRef.current = words;
    simulateFixture(words);
  }, [chapter]);

  /* Upgrade the demo arc to a stage-matched reading-tutor chapter (cached from
   * earlier today, or generated when OPENAI_API_KEY is set server-side).
   *
   * This MUST wait for auth to settle rather than ride the mount effect: the
   * story route requires an ID token in production, and on a direct load of
   * /read the anonymous sign-in is still in flight at mount — a request sent
   * then gets a 401 that the client swallows, so generation would silently
   * never happen and the demo arc would stay forever. Never swaps once the
   * child has started reading; without a key the request 503s and the demo
   * arc simply stays. */
  useEffect(() => {
    if (!profile || authLoading || startedReadingRef.current) return;
    let cancelled = false;
    void (async () => {
      const authToken = user ? await user.getIdToken().catch(() => null) : null;
      const tutorChapter = await requestTutorChapter(profile, user?.uid ?? null, authToken);
      if (tutorChapter && !cancelled && !disposedRef.current && !startedReadingRef.current) {
        setChapter(tutorChapter);
      } else if (!cancelled && !disposedRef.current && !startedReadingRef.current) {
        setChapter((current) => current ? { ...current, provenance: { source: 'fallback', failureReason: latestChapterGenerationFailure() } } : current);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, user, authLoading]);

  useEffect(() => audioSession.subscribe((event) => { if (event.type === 'speech-request') adventureTelemetryRef.current.count('utterance'); }), []);
  useEffect(() => {
    if (lastCountedPageRef.current !== pageIdx) { lastCountedPageRef.current = pageIdx; adventureTelemetryRef.current.count('reading'); }
  }, [pageIdx]);
  useEffect(() => {
    const id = activeInteraction?.id ?? null;
    if (id && lastCountedInteractionRef.current !== id) { lastCountedInteractionRef.current = id; adventureTelemetryRef.current.count('game'); }
    adventureTelemetryRef.current.enter(id ? 'interaction' : phase === 'listening' ? 'listening' : phase === 'correction' ? 'correction' : 'reading');
    if (phase === 'correction' && lastTelemetryPhaseRef.current !== 'correction') adventureTelemetryRef.current.count('correction');
    lastTelemetryPhaseRef.current = phase;
  }, [activeInteraction, phase]);
  useEffect(() => installChapterDebug(() => chapterDebugSnapshot(chapter, scenePackage, adventureTelemetryRef.current, {
    childId: profile?.childId, entitlementSource: subscribed === true ? 'subscription' : 'free',
  })), [chapter, scenePackage, profile?.childId, subscribed]);

  // Reuse the same flat story theme as Home; the controller prevents duplicate loops.
  // Owns theme for as long as this effect's chapter/profile identity holds —
  // cleanup must stop the SAME track it started. This previously called
  // stopAmbience() (a different, unused track), so theme never actually
  // stopped via this path; it only stopped incidentally via the mount
  // effect's own (correct) stopTheme() below, which fires at the same
  // unmount moment. Both now agree, redundantly but harmlessly.
  useEffect(() => {
    if (profile) {
      audioSession.prepareTheme(themeAssetFor(profile.interests[0]));
      audioSession.playTheme();
    }
    return () => audioSession.stopTheme();
  }, [profile]);

  /* Load this child's ChildProgress: local first (synchronous, always
   * available — matches every other store in this app), then a best-effort
   * remote reconcile once auth settles. Every visitor has a uid by this
   * point (AuthProvider signs everyone in anonymously), so this is never
   * gated on being a "real" signed-in parent — see docs/PERSISTENCE.md. */
  useEffect(() => {
    if (!profile || authLoading || !user) return;
    let cancelled = false;
    const uid = user.uid;
    const ageEstimate = stageForAge(profile.age);
    const local = loadLocalProgress(uid, profile.childId) ?? defaultProgressFor(profile.childId, ageEstimate);
    setProgress(local);
    void (async () => {
      const idToken = await user.getIdToken().catch(() => null);
      if (!idToken) return;
      const remote = await fetchRemoteProgress(idToken, profile.childId, ageEstimate);
      if (cancelled || disposedRef.current || !remote) return;
      setProgress(reconcileProgress(uid, profile.childId, local, remote.progress));
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, authLoading, user]);

  // Ownership: this effect is the single place that decides theme's target
  // volume from product state, so nothing else independently ducks/restores
  // it (the synchronous calls added in beginListening/replayCurrentSentence/
  // enterOrEscalateLadder below exist only to remove the one-render-tick lag
  // before this effect would otherwise catch up — they compute the exact
  // same target this effect does, never a competing one).
  //
  // Scoring is deliberately grouped with listening, not partially restored:
  // the wait is typically sub-second to a few seconds, and briefly turning
  // theme back up only to duck it again a moment later for
  // correction/celebrate would read as a glitch, not a considered beat.
  //
  // Correction stays ducked for its ENTIRE duration, not just while
  // `speaking` — the slide-through help interaction (segmentWord()) plays a
  // tick per grapheme and a whole-word TTS blend through stretches of
  // correction where speaking is false, and instructional audio must always
  // be intelligible over the theme, per product rule. This was previously
  // fine to leave un-ducked because the old static-card correction UI had no
  // audio of its own outside the rung 2/3 speakPrompt calls (which already
  // duck synchronously, above).
  useEffect(() => {
    if (phase === 'chapter-end') {
      // The cliffhanger cue (playCliffhanger(), effect below) owns this
      // moment — reading theme must not continue under it, not even ducked.
      audioSession.stopTheme();
    } else if (phase === 'listening' || phase === 'scoring' || phase === 'correction' || speaking) {
      audioSession.setProductMode(phase === 'scoring' ? 'processing' : phase === 'correction' ? 'correction' : 'listening');
    } else {
      audioSession.setProductMode('idle');
    }
  }, [phase, speaking]);

  // See scoringSlow's declaration above: a genuine MDD cold start can make
  // 'scoring' last well past a normal few-second wait. 5s is comfortably
  // above every NORMAL round trip (Azure assessment finalizes near-
  // instantly; a warm MDD call is ~1-2s CPU inference) so this practically
  // never fires on a warm request — it only shows up when there's real
  // waiting to reassure the child through.
  useEffect(() => {
    if (phase !== 'scoring') {
      setScoringSlow(false);
      return;
    }
    const t = setTimeout(() => setScoringSlow(true), 5000);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase === 'chapter-end') {
      audioSession.playCliffhanger();
      if (chapter && profile) {
        const practiced = [...practicedRef.current.keys()][0];
        const specific = practiced ? `You figured out ${practiced}. ` : '';
        const payoff = resolveStoryInteractionManifest(chapter).beats.find((beat) => beat.mechanicType === 'final-story-unlock')?.spokenSuccess ?? chapter.cliffhanger[0];
        audioSession.speak(`${profile.childName}, you did it! ${specific}${payoff}`, { purpose: 'chapter-ending' });
      }
    }
  }, [phase, chapter, profile]);

  // Backgrounding: pause everything immediately (also cancels TTS — resuming
  // stale speech into whatever state the child is in after an unknown-length
  // gap makes no sense). On return, re-derive what SHOULD be playing from
  // the CURRENT phase (not blindly resume whatever was paused): chapter-end
  // already stopped theme on purpose and stays stopped, but it's still the
  // moment the cliffhanger cue owns, so THAT resumes (from where it paused,
  // not restarted); every other phase resumes theme at whatever volume the
  // ownership rule above would already apply (playTheme() itself reads the
  // current `ducked` flag).
  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden) {
        audioSession.background();
      } else {
        audioSession.foreground();
      }
    }
    function onPageHide() {
      audioSession.cancelAll();
      audioSession.stopTheme();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [phase]);

  // Memoized: selectSceneForPage() writes to the recent-scene localStorage
  // history as a side effect (see lib/scene-selector.ts) — must run once per
  // actual (chapter, page) change, not on every unrelated re-render (called
  // before the profile/chapter null-guard below, per rules of hooks). Runs
  // PER PAGE (not once per chapter) so a multi-page chapter progresses
  // through different, thematically-related art instead of one static image.
  const sceneSelection = useMemo(
    () => (chapter ? selectSceneForPage(chapter, chapter.pages[pageIdx] ?? chapter.pages[0], pageIdx, profile?.avatar, user?.uid ?? null) : null),
    [chapter, pageIdx, profile?.avatar, user?.uid],
  );
  const interactionManifest = useMemo(() => chapter ? resolveStoryInteractionManifest(chapter) : null, [chapter]);
  const sessionPlan = useMemo(
    () => chapter && profile && interactionManifest ? buildSessionPlan(chapter, profile.childName, loadReport()?.teaser ?? '', interactionManifest) : [],
    [chapter, profile, interactionManifest],
  );
  const adventureStateAppliedRef = useRef(false);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || adventureStateAppliedRef.current || !chapter || !sessionPlan.length) return;
    const requested = new URLSearchParams(window.location.search).get('adventureState');
    if (!requested) return;
    adventureStateAppliedRef.current = true; setIntroOpen(false);
    if (requested === 'ending') { setPageIdx(chapter.pages.length - 1); setPhase('chapter-end'); return; }
    if (requested === 'story-unlock') { setPageIdx(chapter.pages.length - 1); setPhase('ready'); return; }
    if (requested === 'correction') { setTimeout(() => enterOrEscalateLadder(chapter.pages[0].focusWords[0] ?? 'ship'), 0); return; }
    const interaction = sessionPlan.find((beat) => beat.kind === requested);
    if (interaction && (interaction.kind === 'sound-hunt' || interaction.kind === 'prediction' || interaction.kind === 'word-builder')) setActiveInteraction(interaction);
  }, [chapter, sessionPlan]);
  const lookaheadBeat = useMemo(() => {
    if (!interactionManifest) return null;
    if (activeInteraction) {
      const current = interactionManifest.beats.findIndex((beat) => beat.beatId === activeInteraction.activity.beatId);
      return interactionManifest.beats[current + 1] ?? null;
    }
    return interactionAfterPage(sessionPlan, pageIdx)?.activity ?? null;
  }, [interactionManifest, activeInteraction, sessionPlan, pageIdx]);
  const sceneAssetUrls = useMemo(() => {
    if (!chapter || !interactionManifest) return {} as Record<string, string>;
    return Object.fromEntries(interactionManifest.scenes.map((scene) => {
      const index = scene.pageIndexes[0] ?? 0;
      return [scene.sceneId, sceneUrl(scenePackage, scene.sceneId) ?? selectSceneForPage(chapter, chapter.pages[index], index, profile?.avatar, user?.uid ?? null).asset.src];
    }));
  }, [chapter, interactionManifest, scenePackage, profile?.avatar, user?.uid]);
  const lookaheadScene = lookaheadBeat ? sceneAssetUrls[lookaheadBeat.visualSceneId] ?? null : null;

  useEffect(() => {
    if (!chapter || !interactionManifest || authLoading) return;
    setScenePackage(null);
    const cached = loadChapterScenePackage(chapter.id); if (cached) { setScenePackage(cached); return; }
    let cancelled = false;
    void requestChapterScenePackage(chapter, interactionManifest, user).then((value) => { if (value && !cancelled) setScenePackage(value); });
    return () => { cancelled = true; };
  }, [chapter, interactionManifest, user, authLoading]);

  useEffect(() => {
    if (!chapter || !lookaheadBeat || !lookaheadScene) return;
    if (process.env.NODE_ENV === 'development' && new URLSearchParams(window.location.search).get('disableLookahead') === '1') return;
    void prepareStoryBeat(chapter.id, lookaheadBeat, lookaheadScene);
  }, [chapter, lookaheadBeat, lookaheadScene]);

  useEffect(() => {
    if (!chapter || !interactionManifest || pageIdx !== chapter.pages.length - 1 || phase !== 'ready' || finalUnlockPromptedRef.current) return;
    finalUnlockPromptedRef.current = true;
    const finalUnlock = interactionManifest.beats.find((beat) => beat.mechanicType === 'final-story-unlock');
    if (finalUnlock) audioSession.speak(finalUnlock.spokenInstruction, { purpose: 'final-story-unlock' });
  }, [chapter, interactionManifest, pageIdx, phase]);

  useEffect(() => {
    if (!activeInteraction) return;
    audioSession.speak(activeInteraction.activity.spokenInstruction, { purpose: activeInteraction.kind === 'prediction' ? 'prediction' : 'instruction' });
  }, [activeInteraction]);

  if (!profile || !chapter) return <main className="lc-home-v11 lc-home-loading" data-read-state="loading"><div className="lc-loading-sky" /><div className="lc-loading-book"><span /><span /><span /></div><p>Opening today&rsquo;s story…</p></main>;
  const page = chapter.pages[pageIdx];
  const currentSceneId = interactionManifest?.scenes.find((scene) => scene.pageIndexes.includes(pageIdx))?.sceneId;
  const sceneBg = (currentSceneId ? sceneUrl(scenePackage, currentSceneId) : null) ?? sceneSelection?.asset.src ?? null;
  const sceneFocal = sceneSelection?.asset.focal;
  // Computed for the current tricky word at ANY rung < 3, not just rung 2:
  // with the escalation remap below, a segmentable word now shows the slide
  // interaction at rung 1 (the first stumble) and never actually visits
  // rung 2 again — rung 2's bare-word reveal is reserved for words that
  // don't cleanly segment. Null whenever canTeachWithSlider() says the word
  // isn't safe to blend yet — either segmentWord() can't cover it with
  // graphemes this child is actually expected to know, OR (lib/help-ladder.ts)
  // the curriculum's own sight_word_provenance says it's still irregular at
  // this stage even though it happens to parse cleanly — in which case the
  // plain phoneme/word reveal below is used exactly as it worked before this
  // feature existed.
  const slideSegments = tricky && rung < 3 ? canTeachWithSlider(tricky, stage) : null;

  function replayCurrentSentence() {
    // Never speak the reference text while the mic is live — the recognizer
    // would score the TTS voice as the child's reading (echo cancellation
    // does not reliably remove OS-level TTS from the mic signal). Disabled
    // during 'correction' entirely (see header button below) so this can
    // never race a ladder-driven rung 2/3 utterance.
    if (sessionRef.current || phase === 'listening' || phase === 'scoring') return;
    if (speaking) {
      audioSession.cancelSpeech();
      setSpeaking(false);
      return;
    }
    // Replaying the PAGE text (not a ladder word cue) is "just fed these
    // words" in the same sense reading-tutor's `reread` flag means — see
    // docs/HELP_LADDER_INTEGRATION.md. Only applies when there's no active
    // tricky word, i.e. this is a full-page replay, not a rung cue.
    if (!tricky) pageRereadRef.current = true;
    // Duck synchronously, right here — speakPrompt() below starts audio in
    // this same tick, but the [phase,speaking] effect that would otherwise
    // duck only runs on the NEXT render after setSpeaking(true) commits, one
    // tick behind. Without this, the first instant of speech is audible
    // under full-volume theme.
    setSpeaking(true);
    audioSession.speak(tricky ?? page.text, { purpose: 'sentence-replay', onEnd: () => setSpeaking(false) });
  }

  function armSilenceStop(ms = 3000) {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    // Default must exceed Azure's 2.2 s segmentation pause, and gets re-armed
    // by every partial transcript — so it measures silence since the child
    // last SPOKE, not since the last finalized segment. A 5-year-old's
    // mid-page thinking pause must never cut the mic while they're still
    // reading. Once the live matcher has seen the page's FINAL word, the
    // grace drops to ~1 s: the page is done, so feedback should be quick.
    silenceTimer.current = setTimeout(() => void finishListening(), ms);
  }

  async function beginListening(referenceText: string) {
    setError(null);
    startedReadingRef.current = true;
    liveRef.current = createLiveProgress(referenceText);
    setReadCount(0);
    audioSession.cancelSpeech();
    setSpeaking(false);
    // Duck synchronously — the caller already set phase to 'scoring'/mic
    // setup starts this same tick, ahead of the [phase,speaking] effect's
    // next-render pass. Mic setup can take real time (network/SDK), so this
    // also keeps theme quiet through the "One moment…" wait, not just once
    // Azure's onStatus('listening') callback eventually fires.
    listeningCuePlayedRef.current = false;
    try {
      // Setup watchdog: the token fetch / SDK load / mic prompt can hang on a
      // bad network while the only button sits disabled on "One moment…" —
      // never strand the child there.
      let setupTimedOut = false;
      const setupWatchdog = setTimeout(() => {
        setupTimedOut = true;
        if (!disposedRef.current && !sessionRef.current) {
          setPhase('ready');
          rungRef.current = 0;
          setRung(0);
          setTricky(null);
          pendingFlaggedRef.current = [];
          phraseRetryRef.current = 0;
          setError("That took too long to get ready — let's try again!");
        }
      }, 20_000);
      const authToken = user ? await user.getIdToken() : null;
      const session = await audioSession.startListening(referenceText, {
        authToken,
        onStatus: (s) => {
          if (disposedRef.current) return;
          if (s === 'listening') {
            setPhase('listening');
            if (!listeningCuePlayedRef.current) {
              listeningCuePlayedRef.current = true;
              // AudioSession owns the single listening-start cue.
            }
          }
          if (s === 'error' && sessionRef.current) void finishListening();
        },
        onPartialTranscript: (text) => {
          // Active speech keeps postponing the stop — and moves the cursor.
          if (disposedRef.current) return;
          const n = liveRef.current ? liveRef.current.partial(text) : 0;
          if (LIVE_HIGHLIGHT) setReadCount(n);
          armSilenceStop(liveRef.current?.isComplete() ? 1000 : 3000);
        },
        onSegment: (words) => {
          if (disposedRef.current) return;
          const n = liveRef.current ? liveRef.current.segment(words.map((w) => w.word)) : 0;
          if (LIVE_HIGHLIGHT) setReadCount(n);
          armSilenceStop(liveRef.current?.isComplete() ? 1000 : 3000);
        },
      });
      clearTimeout(setupWatchdog);
      if (disposedRef.current || setupTimedOut) {
        session.cancel();
        return;
      }
      sessionRef.current = session;
      // Safety: if nothing is ever recognized, stop after 25 s.
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      silenceTimer.current = setTimeout(() => void finishListening(), 25_000);
    } catch (e) {
      if (!disposedRef.current) {
        setPhase('ready');
        rungRef.current = 0; // a dead retry-take must not leave the ladder stuck mid-rung
        setRung(0);
        setTricky(null);
        pendingFlaggedRef.current = [];
        phraseRetryRef.current = 0;
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }

  async function finishListening() {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    setPhase('scoring');
    let result: ReadingAssessmentResult;
    try {
      result = await session.stop();
    } catch {
      // stop() only throws when the connection died with ZERO recognized
      // segments — nothing was assessed, so stay on this page and say so.
      // Silently advancing here would fabricate the parent report.
      if (!disposedRef.current) {
        setPhase('ready');
        rungRef.current = 0;
        setRung(0);
        setTricky(null);
        pendingFlaggedRef.current = [];
        phraseRetryRef.current = 0;
        setError("The connection dropped — let's try that page again!");
      }
      return;
    }
    if (disposedRef.current) return;
    try {
      const { verdicts, decode: decodeResult } = await decodeReading(result);
      if (disposedRef.current) return;
      handleVerdicts(result, verdicts, decodeResult);
    } catch {
      if (!disposedRef.current) advance(); // scoring hiccup on a real read — never strand the child
    }
  }

  async function decodeReading(r: ReadingAssessmentResult): Promise<{ verdicts: WordVerdict[]; decode: DecodeResult | null }> {
    if (!r.audioWav || r.words.length === 0) {
      const verdicts = combineVerdicts(r.words, null);
      await exposeVerdictDebug(verdicts, false);
      return { verdicts, decode: null };
    }
    try {
      const authToken = user ? await user.getIdToken() : null;
      const form = new FormData();
      form.append('audio', r.audioWav, 'reading.wav');
      form.append('text', r.referenceText);
      const res = await fetch('/api/reading/decode', {
        method: 'POST',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        body: form,
      });
      if (!res.ok) throw new Error(String(res.status));
      const decodeResult = (await res.json()) as DecodeResult;
      const verdicts = combineVerdicts(r.words, decodeResult);
      await exposeVerdictDebug(verdicts, true);
      return { verdicts, decode: decodeResult };
    } catch {
      const verdicts = combineVerdicts(r.words, null);
      await exposeVerdictDebug(verdicts, false);
      return { verdicts, decode: null };
    }
  }

  async function exposeVerdictDebug(verdicts: WordVerdict[], mddAvailable: boolean) {
    try {
      if (!readingDebugEnabled(window.location.search)) return;
      const payload = buildReadingDebugPayload(verdicts, mddAvailable);
      await fetch('/api/reading/debug-verdict?debugReading=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });
    } catch {
      // Diagnostics must never affect grading or strand the reading flow.
    }
  }

  /** Diagnostic infrastructure, not a feature: per-word verdict logging so
   *  "why didn't that register as a stumble" is answerable from DevTools
   *  instead of guessed at. Never rendered in the UI, never touches
   *  needsHelp/reason/confidence — purely reads what combineVerdicts() and
   *  toWordSignals() already computed.
   *
   *  Deliberately NOT gated on NODE_ENV === 'development': that check is
   *  FALSE on every Vercel deployment, preview included (`next build`
   *  always sets NODE_ENV=production — the same reason the sim: buttons
   *  and the old [Canonical session] log never appear there either), so a
   *  dev-only gate would make this invisible on exactly the environment
   *  real testing happens on. console.debug() is the actual gate instead —
   *  Chrome/Firefox DevTools hide Debug-level messages by default (only
   *  Info/Warning/Error show unless "Verbose"/"Debug" is switched on), so
   *  it stays out of the way without being unreachable when it's needed. */
  function logVerdictDiagnostics(r: ReadingAssessmentResult, verdicts: WordVerdict[], decodeResult: DecodeResult | null) {
    const { diagnostics, signals } = toWordSignals(r.words, decodeResult);
    let si = 0; // walks diagnostics/signals, which skip Insertions — verdicts does not
    const rows = verdicts.map((v) => {
      if (v.errorType === 'Insertion') {
        return {
          word: v.word,
          errorType: v.errorType,
          needsHelp: v.needsHelp,
          reason: v.reason,
          graders: 'n/a (insertion)',
          azureAccuracy: v.azureAccuracy,
          azureMinPhoneme: v.azureMinPhoneme,
          decodeScore: null as number | null,
          confidence: null as number | null,
        };
      }
      const confidence = signals[si]?.confidence ?? null;
      si += 1;
      return {
        word: v.word,
        errorType: v.errorType,
        needsHelp: v.needsHelp,
        reason: v.reason,
        // decodeScore is only ever null here because the MDD service was
        // unreachable for THIS request (decodeReading()'s catch branch) —
        // see combineVerdicts' azure-only-fallback threshold, which is
        // stricter (<40) than the dual-grader default (<50).
        graders: v.decodeScore != null ? 'azure+mdd' : 'azure-only (MDD unreachable)',
        azureAccuracy: v.azureAccuracy,
        azureMinPhoneme: v.azureMinPhoneme,
        decodeScore: v.decodeScore,
        confidence,
      };
    });
    console.debug(`[Verdict] rung ${rungRef.current} · page ${pageIdx} · "${page.text.slice(0, 50)}${page.text.length > 50 ? '…' : ''}"`);
    console.table(rows);
  }

  /** Stores this take's adapted WordSignal[]/interventions as the page's
   *  canonical measurement. Called ONLY for the first, whole-page take
   *  (rungRef.current === 0) — a rung 1/2 retry take covers just the
   *  flagged word, not the page, and must never overwrite this. */
  function storePageSignals(words: ReadingAssessmentResult['words'], decodeResult: DecodeResult | null) {
    const { signals, interventions } = toWordSignals(words, decodeResult);
    pageSignalsRef.current = signals;
    pageInterventionsRef.current = interventions;
  }

  /** One rung up from wherever the ladder currently is for this page.
   *  Rungs 1/2 show a text-free help interaction (SlideWordHelp for a
   *  segmentable word, AudioWordHelp otherwise — see the render below) and
   *  offer one more mic attempt; rung 3 reads the whole sentence aloud and
   *  marks the page assisted — see docs/HELP_LADDER_INTEGRATION.md and
   *  reading-tutor/content/config.json help_template. Rung 2's own
   *  speakPrompt() line was retired: AudioWordHelp now owns pronouncing the
   *  word for every rung < 3 an unsegmentable word visits, so a second,
   *  parent-level utterance here would just race/cancel it (speakPrompt()
   *  cancels any in-flight utterance before starting a new one). */
  function enterOrEscalateLadder(word: string) {
    // A word already shown the slide interaction at rung 1 that still needs
    // help skips the old bare-word rung 2 reveal entirely — the slider
    // already showed every letter, so rung 2 would teach nothing new.
    // Escalate straight to rung 3's sentence fallback instead ("if still
    // struggling, escalate to the remaining stronger help"). Words that
    // don't segment keep the original 1 -> 2 -> 3 progression untouched —
    // AudioWordHelp re-pronounces the word fresh on each escalation (it's
    // keyed by rung in the render below).
    const skipToSentenceFallback = rungRef.current === 1 && canTeachWithSlider(word, stage) !== null;
    const next: 1 | 2 | 3 = skipToSentenceFallback ? 3 : (Math.min(3, rungRef.current + 1) as 1 | 2 | 3);
    rungRef.current = next;
    setRung(next);
    setTricky(word);
    setHelpDone(false);
    practicedRef.current.set(word, `the word “${word}” — worth a little practice together`);
    setPhase('correction');
    if (next === 3) {
      pageAssistedRef.current = true;
      setSpeaking(true);
      audioSession.speak(rungLine(3, { word, sentence: page.text, stage }), { purpose: 'correction-rung-3',
        onEnd: () => {
          if (disposedRef.current) return;
          setSpeaking(false);
          // "no pause, no second chance, no change in tone" — the same
          // no-fanfare advance the manual skip button already uses, never
          // the celebratory cue. Still checks the pending queue first: a
          // page with more than one stumble must not drop the others just
          // because THIS one escalated all the way to rung 3.
          finishWordOrContinue(pickEncouragement(), false);
        },
      });
    }
  }

  /** Called once a word is done with the ladder — either it was just read
   *  correctly, or the child skipped it. If the ORIGINAL whole-page take
   *  flagged more than one word, hands the ladder to the next one (fresh, at
   *  rung 1 — see enterOrEscalateLadder) instead of celebrating; only once
   *  every flagged word has had its turn does the page actually celebrate
   *  and advance. */
  function finishWordOrContinue(praise: string, cue: boolean) {
    const next = pendingFlaggedRef.current.shift();
    if (next !== undefined) {
      rungRef.current = 0; // a new word is its own first stumble, not a continuation of the last one's rung
      setRung(0);
      enterOrEscalateLadder(next);
      return;
    }
    celebrateAndAdvance(praise, cue);
  }

  /** Fires when isPhraseUnreliable() judges a WHOLE take globally
   *  unreliable — a catastrophic misread, unrelated speech, or silence —
   *  rather than a handful of individually addressable words. Never stores
   *  this take as the page's canonical signal and never awards pet credit
   *  for it: it isn't real evidence of how the child reads, so it must not
   *  count as either a success OR a failure. Offers up to
   *  HELP_LADDER.max_retries phrase-level retries — model the whole
   *  sentence, then reopen the mic for a fresh whole-page attempt, exactly
   *  like the child tapping the mic button themselves; a retry that comes
   *  back reliable falls straight into the normal handleVerdicts() path
   *  below (rungRef/awardedRef were never touched, so it's treated exactly
   *  like an ordinary first take). Once retries are exhausted, falls back
   *  to the SAME whole-sentence modeling + assisted:true + quiet, no-
   *  fanfare continue that rung 3 already uses for a single word — reusing
   *  that frozen, already-excluded-from-progression bucket rather than
   *  inventing new persistence semantics — so a repeatedly-unreliable page
   *  still always resolves instead of looping the child forever. */
  function handlePhraseFailure(r: ReadingAssessmentResult, verdicts: WordVerdict[], decodeResult: DecodeResult | null) {
    phraseRetryRef.current += 1;
    if (phraseRetryRef.current > HELP_LADDER.max_retries) {
      storePageSignals(r.words, decodeResult);
      pageAssistedRef.current = true;
      setTricky(null); // no single word — the WHOLE sentence is what's modeled
      setPhase('correction');
      setSpeaking(true);
      audioSession.speak(rungLine(3, { word: '', sentence: page.text, stage }), { purpose: 'phrase-model',
        onEnd: () => {
          if (disposedRef.current) return;
          setSpeaking(false);
          finishWordOrContinue(pickEncouragement(), false);
        },
      });
      return;
    }
    setTricky(null);
    setPhase('correction');
    setSpeaking(true);
    audioSession.speak(phraseRetryLine(page.text), { purpose: 'phrase-retry-model',
      onEnd: () => {
        if (disposedRef.current) return;
        setSpeaking(false);
        setPhase('scoring');
        void beginListening(page.text);
      },
    });
  }

  function handleVerdicts(r: ReadingAssessmentResult, verdicts: WordVerdict[], decodeResult: DecodeResult | null) {
    logVerdictDiagnostics(r, verdicts, decodeResult);
    const flagged = verdicts.filter((v) => v.needsHelp);

    // Phrase-level failure boundary — only evaluated on a whole-page take
    // (rungRef.current === 0 covers both the very first take AND every
    // phrase-retry re-listen above, since neither ever touches rungRef). A
    // per-word rung 1/2 retry take targets a single word, never a "phrase";
    // isPhraseUnreliable's own minWordsToJudge guard would reject it anyway,
    // but gating on rungRef here keeps the intent explicit. See
    // lib/reading-verdict.ts for why this is safe: a separate, additive
    // signal built entirely from combineVerdicts()'s own (unchanged) output.
    if (rungRef.current === 0 && isPhraseUnreliable(verdicts)) {
      handlePhraseFailure(r, verdicts, decodeResult);
      return;
    }

    if (rungRef.current === 0) {
      storePageSignals(r.words, decodeResult);
      // Queue every OTHER flagged word from this whole-page take (a retry
      // take re-listens to just one word, so `flagged` here is always a
      // singleton on every subsequent call — this only ever (re)populates
      // on the first, whole-page take, which is exactly when it should).
      pendingFlaggedRef.current = flagged.slice(1).map((v) => v.word);
    }
    if (!awardedRef.current && rungRef.current === 0) {
      // Award once per page — a word-retry take is practice, not a reading.
      // awardedRef (not rungRef) is the gate: error recoveries reset rungRef
      // to keep the ladder usable, and that reset must never re-arm a
      // second award for the same page.
      awardedRef.current = true;
      pet.awardReading({
        accuracy: r.scores.accuracy,
        wordCount: r.words.filter((w) => w.errorType !== 'Insertion').length,
        flaggedCount: flagged.length,
      });
    }
    if (flagged.length > 0 && rungRef.current < 3) {
      // Any still-flagged result escalates the ladder one rung — including
      // a silent retry (an all-Omission result combineVerdicts already
      // flags): see docs/HELP_LADDER_INTEGRATION.md, "silence enters the
      // same ladder" — there is no separate silence path here.
      enterOrEscalateLadder(flagged[0].word);
      return;
    }
    // This word passed (or exhausted rung 3). The praise rewards the effort,
    // not the original stumble — but only actually shows once every flagged
    // word from this page has had its turn (see finishWordOrContinue).
    finishWordOrContinue(rungRef.current > 0 ? 'You did it!' : praiseFor(r.scores.accuracy, flagged.length), true);
  }

  function celebrateAndAdvance(p: string, cue = true) {
    // Clear the correction card immediately — otherwise it lingers behind
    // the celebrate visual until advance() fires later, showing two states'
    // UI at once (the correction card was only ever meant to survive through
    // the RETRY's listening/scoring, not into celebrate).
    setTricky(null);
    setPraise(p);
    setCelebrateCue(cue);
    if (cue) audioSession.playReadingCue('section-success.mp3');
    setPhase('celebrate');
    // A real independent/retry success gets the brief star+sparkle+glow
    // beat (long enough for lc-success-pop + the sparkle drift to actually
    // finish, short enough that the story visibly rewards the child by
    // continuing rather than making them wait on a screen). An assisted
    // rung-3 advance (cue=false) has no animation to wait out — the "no
    // pause, no second chance, no change in tone" comment above its caller
    // means this hold should be as brief as the phase transition itself.
    setTimeout(() => {
      if (!disposedRef.current) advance();
    }, cue ? 700 : 350);
  }

  /** Pushes the current page's finished SentenceResult onto the
   *  chapter-lifetime accumulator. Only pushes when a whole-page measurement
   *  actually exists (see storePageSignals) — every reachable path into
   *  advance() has already produced one. */
  function finalizeCurrentPage() {
    const signals = pageSignalsRef.current;
    if (!signals) return;
    sentenceResultsRef.current.push({
      index: pageIdx,
      text: page.text,
      words: signals,
      assisted: pageAssistedRef.current,
      reread: pageRereadRef.current,
    });
    interventionsRef.current.push(pageInterventionsRef.current ?? signals.map(() => false));
  }

  function advance() {
    setSentenceLeaving(true);
    finalizeCurrentPage();
    setTimeout(() => {
      if (disposedRef.current) return;
      setTricky(null);
      rungRef.current = 0;
      setRung(0);
      awardedRef.current = false;
      pendingFlaggedRef.current = [];
      phraseRetryRef.current = 0;
      liveRef.current = null;
      setReadCount(0);
      pageSignalsRef.current = null;
      pageInterventionsRef.current = null;
      pageAssistedRef.current = false;
      pageRereadRef.current = false;
      const interaction = interactionAfterPage(sessionPlan, pageIdx);
      if (interaction && pageIdx + 1 < chapter!.pages.length) {
        setPendingNextPage(pageIdx + 1);
        setInteractionChoice(null);
        setActiveInteraction(interaction);
        setPhase('ready');
      } else if (pageIdx + 1 < chapter!.pages.length) {
        audioSession.playReadingCue('page-turn.mp3');
        setPageIdx((i) => i + 1);
        setPhase('ready');
      } else {
        finishChapter();
      }
      setSentenceLeaving(false);
    }, 140);
  }

  function finishChapter() {
    if (!claimEndingCompletion(finishChapterRef)) return;
    audioSession.cancelAll();
    const c = chapter!;
    // Dedupe: a generated chapter may practise one or two words across every
    // page, and "den, den, den" reads like a bug to the parent.
    const newWords = [
      ...new Set(c.pages.flatMap((p) => p.focusWords).filter((w) => w !== c.character)),
    ];
    const report = {
      date: new Date().toLocaleDateString('en-CA'), // local YYYY-MM-DD, not UTC
      chapterId: c.id,
      childName: profile!.childName,
      newWords,
      // Words the child actually struggled with come FIRST so they survive the
      // parent screen's top-3 slice; generic chapter phonics fill the rest.
      practiced: [...practicedRef.current.entries()]
        .map(([word, hint]) => ({ word, hint }))
        .concat(c.phonics.map((ph) => ({ word: ph.words[0], hint: ph.hint }))),
      teaser: c.teaser,
    };
    saveReport(report);
    // Marks THIS chapter done so /home stops offering it as "ready to read"
    // until tomorrow's chapter id rolls over — independent of auth (works for
    // the anonymous default, unlike the parent-message send below).
    appendChapterHistoryEntry(user?.uid ?? null, report);
    // Signed-in parents opted into the session note at registration — send it
    // (in-app always; SMS when Twilio + their phone number are configured).
    // Best-effort: a delivery failure must never affect the child's flow.
    const communication = loadPreferences().communication;
    if (user && !user.isAnonymous && communication !== 'off') {
      void (async () => {
        try {
          const authToken = await user.getIdToken();
          await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({
              deliveryMode: communication,
              sessionData: {
                childName: profile!.childName,
                newWords,
                practicedWords: [...practicedRef.current.entries()].map(([word, hint]) => ({ word, hint })),
                mostlyAssisted: false,
                tomorrowTeaser: c.teaser,
              },
            }),
          });
        } catch {
          /* message delivery is best-effort */
        }
      })();
    }

    // Assemble the canonical session and persist it — interpreted through
    // interpretSessionWithIntervention() ONLY (never interpretSession()
    // directly), applied through John's unmodified applySession(), exactly
    // once per chapterId regardless of retries. See
    // lib/child-progress.ts/lib/progress-store-admin.ts and
    // docs/PERSISTENCE.md for the idempotency + ownership design.
    //
    // Local completion is synchronous and is what actually gates the
    // returned `progress`/`reading` used below — it's correct with zero
    // network dependency, matching every other store in this app. The
    // server mirror is fire-and-forget: PHASE 4 explicitly says not to
    // block the chapter-end screen on an optional downstream write.
    const session: SessionInput = {
      childId: profile!.childId,
      sessionId: sessionIdRef.current,
      stage,
      chapterId: c.id,
      isBookshelfReread: false,
      startedAt: startedAtRef.current,
      sentences: sentenceResultsRef.current,
    };
    const uid = user?.uid ?? null;
    const ageEstimate = stageForAge(profile!.age);
    const previouslyTricky = progress?.trickyWords ?? [];
    const { reading, progress: updatedProgress, applied } = completeSessionLocally(
      uid,
      profile!.childId,
      ageEstimate,
      session,
      interventionsRef.current,
      previouslyTricky,
    );
    setProgress(updatedProgress);

    if (user) {
      void (async () => {
        try {
          const idToken = await user.getIdToken();
          const remote = await completeSessionRemote(
            idToken,
            profile!.childId,
            ageEstimate,
            session,
            interventionsRef.current,
            previouslyTricky,
          );
          // Remote is the cross-device copy — reconcile only if it moved
          // further than what local already has (see reconcileProgress).
          if (remote && !disposedRef.current) {
            setProgress((current) =>
              current ? reconcileProgress(uid, profile!.childId, current, remote.progress) : current,
            );
          }
        } catch {
          /* best-effort mirror — local persistence already succeeded */
        }
      })();
    }

    if (process.env.NODE_ENV === 'development') {
      // Safe summary only — no accuracy, no score, nothing child/parent-facing.
      console.info('[Canonical session]', {
        sentenceCount: session.sentences.length,
        assistedSentenceCount: session.sentences.filter((s) => s.assisted).length,
        trickyWords: reading.trickyWords,
        cleanWords: reading.cleanWords,
        excludedFromProgression: reading.excludedFromProgression,
        progressionApplied: applied,
        stage: updatedProgress.stage,
      });
    }

    setPhase('chapter-end');
  }

  function continueAfterInteraction() {
    if (pendingNextPage == null) return;
    audioSession.playReadingCue('page-turn.mp3');
    setPageIdx(pendingNextPage);
    setPendingNextPage(null);
    setActiveInteraction(null);
    setInteractionChoice(null);
    setInteractionFeedback('idle');
    setWordBuilderProgress(0);
    setPhase('ready');
  }

  function chooseInteraction(choice: string) {
    if (!activeInteraction || interactionFeedback === 'success') return;
    setInteractionChoice(choice);
    if (activeInteraction.kind === 'prediction') {
      setInteractionFeedback('success');
      audioSession.speak(activeInteraction.activity.spokenSuccess, {
        purpose: 'prediction-acknowledgment',
        onEnd: () => setTimeout(continueAfterInteraction, 350),
      });
      return;
    }
    const correct = choice === activeInteraction.activity.correctTarget;
    setInteractionFeedback(correct ? 'success' : 'try-again');
    const pattern = activeInteraction.activity.literacyTarget ?? '';
    audioSession.speak(correct ? activeInteraction.activity.spokenSuccess : `${choice}. Listen again… ${pattern}.`, {
      purpose: correct ? 'sound-hunt-success' : 'sound-hunt-retry',
      onEnd: correct ? () => setTimeout(continueAfterInteraction, 700) : undefined,
    });
  }

  function chooseWordPart(index: number) {
    if (!activeInteraction || activeInteraction.kind !== 'word-builder' || index !== wordBuilderProgress) return;
    const part = activeInteraction.activity.interactiveObjects[index];
    const next = index + 1;
    setWordBuilderProgress(next);
    audioSession.speak(part.spokenLabel, {
      purpose: 'phoneme-model',
      onEnd: next === activeInteraction.activity.interactiveObjects.length ? () => {
        setInteractionFeedback('success');
        audioSession.speak(activeInteraction.activity.spokenSuccess, {
          purpose: 'word-blend', onEnd: () => setTimeout(continueAfterInteraction, 650),
        });
      } : undefined,
    });
  }

  /* Dev-only shortcut so the whole flow is testable without a microphone.
   * Uses the REAL combineVerdicts() on fabricated WordScore data (not a
   * hand-rolled verdict list) so the sim's flagging decision and the
   * adapter's `interventions` output are always consistent with each other
   * — see docs/HELP_LADDER_INTEGRATION.md. */
  function simulate(kind: 'good' | 'tricky') {
    startedReadingRef.current = true; // sims count as reading — no chapter swaps mid-flow
    const words = page.text.split(/\s+/).map((t) => t.toLowerCase().replace(/[^a-z']/g, '')).filter(Boolean);
    const bad = (i: number) => kind === 'tricky' && i === words.length - 1;
    const fakeResult = {
      scores: { pronunciation: 90, accuracy: kind === 'good' ? 94 : 70, fluency: 90, completeness: 100, prosody: 80 },
      words: words.map((w, i) => ({
        word: w,
        accuracy: bad(i) ? 30 : 95,
        errorType: 'None',
        offsetMs: 250 + i * 350,
        durationMs: 300,
        phonemes: [{ phoneme: 'ə', accuracy: bad(i) ? 20 : 95 }],
      })),
    } as unknown as ReadingAssessmentResult;
    const verdicts = combineVerdicts(fakeResult.words, null);
    handleVerdicts(fakeResult, verdicts, null);
  }

  /* Dev-only: simulates ONE mic retry take for the current ladder word
   * (rung 1/2's "Try the word" button, without opening a real mic) — lets
   * the ladder's escalation logic (rung 1 → 2 → 3) be exercised headlessly.
   * Real combineVerdicts(), same as simulate() above. */
  function simulateRetry(kind: 'ok' | 'stumble') {
    const word = tricky;
    if (!word) return;
    const fakeResult = {
      scores: { pronunciation: kind === 'ok' ? 92 : 40, accuracy: kind === 'ok' ? 92 : 30, fluency: 90, completeness: 100, prosody: 80 },
      words: [{
        word, accuracy: kind === 'ok' ? 92 : 30, errorType: 'None', offsetMs: 250, durationMs: 300,
        phonemes: [{ phoneme: 'ə', accuracy: kind === 'ok' ? 90 : 20 }],
      }],
    } as unknown as ReadingAssessmentResult;
    const verdicts = combineVerdicts(fakeResult.words, null);
    handleVerdicts(fakeResult, verdicts, null);
  }

  /* Dev-only: stream fake partial transcripts through the real highlight
   * path so the karaoke effect is testable without a microphone. */
  function simulateLive() {
    const live = createLiveProgress(page.text);
    liveRef.current = live;
    setReadCount(0);
    setPhase('listening');
    const words = page.text.split(/\s+/).filter(Boolean);
    let i = 0;
    const timer = setInterval(() => {
      if (disposedRef.current) {
        clearInterval(timer);
        return;
      }
      i++;
      setReadCount(live.partial(words.slice(0, i).join(' ')));
      if (i >= words.length) {
        clearInterval(timer);
        setTimeout(() => {
          if (!disposedRef.current) simulate('good');
        }, 600);
      }
    }, 350);
  }

  /* Dev-only/test-only: builds an arbitrary WordScore[] take (any words,
   * accuracies, error types — including more than one flagged word in a
   * single take) and runs it through the REAL combineVerdicts() +
   * handleVerdicts(), exactly like simulate()/simulateRetry() above, just
   * generalized past their fixed "good"/"tricky" shapes. Exists so the
   * correction state machine (ladder eligibility, the multi-flagged-word
   * queue, escalation) can be driven deterministically by real WordVerdict
   * objects in tests without a live mic/Azure/MDD round trip — see the
   * ?fixtureTake query hook below, its only caller. */
  function simulateFixture(words: { word: string; accuracy: number; errorType?: string }[]) {
    startedReadingRef.current = true;
    const fakeResult = {
      scores: { pronunciation: 90, accuracy: 90, fluency: 90, completeness: 100, prosody: 80 },
      words: words.map((w) => ({
        word: w.word,
        accuracy: w.accuracy,
        errorType: w.errorType ?? 'None',
        offsetMs: 250,
        durationMs: 300,
        phonemes: w.errorType === 'Omission' ? [] : [{ phoneme: 'ə', accuracy: w.accuracy < 50 ? 20 : 95 }],
      })),
    } as unknown as ReadingAssessmentResult;
    const verdicts = combineVerdicts(fakeResult.words, null);
    handleVerdicts(fakeResult, verdicts, null);
  }

  if (introOpen) {
    const welcome = sessionPlan.find((beat): beat is Extract<SessionBeat, { kind: 'welcome' }> => beat.kind === 'welcome');
    return (
      <div className="lc-session-interaction" data-session-beat="welcome">
        <SceneBackground src={sceneBg} focal={sceneFocal} />
        <div className="lc-interaction-card lc-scene-content">
          <p className="lc-interaction-kicker">Welcome to today’s chapter</p>
          <h1>Let’s find out what happens next.</h1>
          <p>{welcome?.spokenLine}</p>
          <button className="btn-primary lc-interaction-continue" onClick={() => {
            if (!welcome) { setIntroOpen(false); return; }
            setSpeaking(true);
            audioSession.speak(welcome.spokenLine, { purpose: 'session-welcome', onEnd: () => setSpeaking(false) });
            setIntroOpen(false);
          }}>{speaking ? 'Listen…' : 'Open the story'}</button>
          <SessionProgress current={0} total={sessionPlan.length} />
        </div>
      </div>
    );
  }

  if (activeInteraction) {
    const sound = activeInteraction.kind === 'sound-hunt' ? activeInteraction.activity : null;
    const choices = activeInteraction.activity.interactiveObjects;
    const acknowledged = activeInteraction.kind === 'word-builder' && interactionFeedback === 'success'
      ? activeInteraction.activity.successStoryAction
      : interactionChoice
      ? activeInteraction.kind === 'prediction'
        ? `Let’s see!`
        : interactionFeedback === 'success'
          ? `You found ${sound?.literacyTarget}!`
          : `Listen again… ${sound?.literacyTarget}.`
      : null;
    return (
      <div className="lc-session-interaction" data-session-beat={activeInteraction.kind}>
        <SceneBackground src={sceneBg} focal={sceneFocal} />
        <div className="lc-interaction-card lc-scene-content">
          <button className="lc-prompt-speaker" aria-label="Hear the question again" onClick={() => audioSession.speak(activeInteraction.activity.spokenInstruction, { purpose: 'interaction-prompt-replay' })}><img src="/icons/speaker-audio.png" alt="" /></button>
          <p className="lc-interaction-kicker">{activeInteraction.kind === 'sound-hunt' ? 'Listen for the sound' : activeInteraction.kind === 'word-builder' ? 'Build the story word' : 'What happens next?'}</p>
          <h1>{activeInteraction.kind === 'sound-hunt' ? sound?.literacyTarget?.toUpperCase() : activeInteraction.kind === 'word-builder' ? activeInteraction.activity.literacyTarget?.toUpperCase() : 'Choose a picture'}</h1>
          <div className={`lc-choice-grid is-${activeInteraction.kind}${interactionFeedback === 'success' ? ' is-world-reacting' : ''}`}>
            {choices.map((choice, index) => <button key={choice.objectId} data-correct={activeInteraction.kind === 'sound-hunt' && choice.label === sound?.correctTarget ? 'true' : undefined} className={`${interactionChoice === choice.label ? 'is-chosen' : ''}${interactionChoice === choice.label && interactionFeedback === 'try-again' ? ' is-try-again' : ''}${interactionChoice === choice.label && interactionFeedback === 'success' ? ' is-success' : ''}${activeInteraction.kind === 'word-builder' && index < wordBuilderProgress ? ' is-built' : ''}`} onClick={() => activeInteraction.kind === 'word-builder' ? chooseWordPart(index) : chooseInteraction(choice.label)} aria-label={choice.spokenLabel}>
              {activeInteraction.kind === 'prediction' && <span className={`lc-prediction-picture picture-${index + 1}`}><img src={sceneAssetUrls[choice.visualSceneId] ?? sceneBg ?? '/images/scenes/bg-meadow-path-sunny-01.jpg'} alt="" /><i aria-hidden>{index === 0 ? '✦' : ')))'}</i></span>}
              <strong>{choice.label}</strong>{activeInteraction.kind !== 'word-builder' && <span className="lc-word-speaker" aria-hidden><img src="/icons/speaker-audio.png" alt="" /></span>}
            </button>)}
          </div>
          {acknowledged && <p role="status">{acknowledged}</p>}
          <SessionProgress current={sessionPlan.findIndex((beat) => beat.id === activeInteraction.id)} total={sessionPlan.length} />
        </div>
      </div>
    );
  }

  /* ── Screen 5: meaningful chapter ending ── */
  if (phase === 'chapter-end') {
    const finalUnlock = interactionManifest?.beats.find((beat) => beat.mechanicType === 'final-story-unlock');
    return (
      <div className="lc-session-interaction lc-ending-v11" data-session-beat="ending">
        <SceneBackground src={sceneBg} focal={sceneFocal} cliff />
        <div className="lc-interaction-card lc-scene-content">
          <div className="lc-ending-stars" aria-hidden>{[0,1,2].map((star) => <img key={star} src="/icons/success-star.png" alt="" />)}</div>
          <p className="lc-interaction-kicker">Adventure complete</p>
          <h1>You did it, {profile.childName}!</h1>
          <div className="lc-ending-event"><strong>{finalUnlock?.successStoryAction ?? chapter.cliffhanger[0]}</strong><span>{chapter.teaser}</span></div>
          <button className="btn-primary lc-interaction-continue" onClick={() => {
            audioSession.cancelAll(); audioSession.stopTheme(); router.push(subscribed === true ? '/home' : '/home?grownupHandoff=1');
          }}>Back to Home</button>
        </div>
      </div>
    );
  }

  /* ── Screen 4: reading ── */
  return (
    <div className={`scene lc-scenic lc-reading-scene${phase === 'listening' ? ' lc-listening' : ''}`} style={{ position: 'relative' }}>
    <SceneBackground src={sceneBg} focal={sceneFocal} />
    <div className="screen lc-scene-content">
      <header className="lc-top-controls" style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 18px' }}>
        <button
          className="icon-btn"
          aria-label="Close"
          // close.png already carries its own cream circle + shadow, so the
          // button's CSS background is dropped here to avoid a double ring.
          style={{ background: 'transparent', boxShadow: 'none' }}
          onClick={() => {
            // Full teardown BEFORE navigating: a still-resolving session or a
            // pending silence timer must not resurrect the flow mid-exit.
            disposedRef.current = true;
            if (silenceTimer.current) clearTimeout(silenceTimer.current);
            sessionRef.current?.cancel();
            sessionRef.current = null;
            // Immediate, not "whenever React gets around to unmounting":
            // router.push() is async, and any TTS/theme still audible at the
            // moment of the tap should cut the instant the child taps close,
            // not a navigation-tick later. The unmount cleanup below still
            // runs too — harmless, everything it stops is already stopped.
            audioSession.cancelAll();
            audioSession.stopTheme();
            audioSession.playHomeSound('close.mp3');
            router.push('/home');
          }}
        >
          <img src="/icons/close.png" alt="" style={{ width: '112%', height: '112%', objectFit: 'contain' }} />
        </button>
        <button
          className={`icon-btn${speaking ? ' lc-speaking-active' : ''}`}
          aria-label={speaking ? 'Stop reading aloud' : 'Read aloud'}
          // Disabled through the whole help ladder, not just listening/
          // scoring: rung 2/3 drive their own TTS, and letting the header
          // button cancel() mid-utterance would race that same utterance's
          // onend/onerror — see docs/HELP_LADDER_INTEGRATION.md.
          disabled={phase === 'listening' || phase === 'scoring' || phase === 'correction'}
          style={phase === 'listening' || phase === 'scoring' || phase === 'correction' ? { opacity: 0.45, cursor: 'default' } : undefined}
          onClick={() => {
            if (phase === 'listening' || phase === 'scoring' || phase === 'correction') return;
            audioSession.playHomeSound('replay.mp3');
            replayCurrentSentence();
          }}
        >
          <SpeakerIcon size={22} color="var(--blue)" />
        </button>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '4px 22px 26px' }}>
        <div
          className={phase === 'celebrate' && celebrateCue ? 'lc-reading-card-in lc-celebrate-glow' : 'lc-reading-card-in'}
          style={{
            background: '#fffdf8',
            borderRadius: 18,
            padding: '26px 24px 18px',
            boxShadow: '0 4px 14px rgba(43,43,43,0.12)',
          }}
        >
          {/* Keep the ladder card visible through a retry's listening/scoring —
              hiding it the moment the child taps "Try the word" defeats it.
              Rung 3 shows the normal page text instead (the whole sentence
              is being read aloud, not a single word). */}
          {tricky && rung < 3 ? (
            slideSegments ? (
              // The slide interaction IS the rung-1 experience for a
              // segmentable word — no competing text or decoration, so the
              // word and the track are the only things on the card. Keyed
              // by rung so an escalation (rare — see enterOrEscalateLadder,
              // most segmentable-word failures jump straight to rung 3)
              // still remounts cleanly rather than reusing stale state.
              <SlideWordHelp
                key={rung}
                word={tricky}
                segments={slideSegments}
                onComplete={() => {
                  setSpeaking(true);
                  audioSession.speak(tricky, { purpose: 'slider-word-blend',
                    onEnd: () => {
                      if (disposedRef.current) return;
                      setSpeaking(false);
                      // Only NOW is it "the child's turn" — the mic button
                      // stays disabled until the blended word has actually
                      // finished playing, so sliding + hearing the blend
                      // visibly precedes retrying aloud.
                      setHelpDone(true);
                    },
                  });
                }}
              />
            ) : (
              // segmentWord() couldn't cleanly cover this word with
              // graphemes the child is actually expected to know at this
              // stage — never guess a segmentation. AudioWordHelp
              // pronounces the WHOLE word instead; never a phoneme-by-
              // phoneme cue, never visible slash-notation. Keyed by rung so
              // a second failure re-pronounces fresh rather than sitting on
              // the previous attempt's "your turn" state.
              <AudioWordHelp key={rung} word={tricky} onComplete={() => setHelpDone(true)} />
            )
          ) : (
            <div key={pageIdx} className={sentenceLeaving ? 'lc-sentence-out' : 'lc-sentence-in'}>
              <PageText text={page.text} focusWords={page.focusWords} live={LIVE_HIGHLIGHT && phase === 'listening'} readCount={readCount} />
            </div>
          )}
          <div aria-hidden style={{ textAlign: 'center', marginTop: 20, letterSpacing: 4, fontSize: 10, color: 'var(--leaf)' }}>
            {chapter.pages.map((_, i) => (
              <span key={i} style={{ opacity: i === pageIdx ? 1 : 0.35 }}>
                {i === pageIdx ? '●' : '○'}
              </span>
            ))}
          </div>
        </div>

        {error && (
          <div
            style={{
              marginTop: 14,
              background: 'var(--sky-soft)',
              border: '1px solid var(--sky)',
              color: 'var(--ink)',
              borderRadius: 12,
              padding: '10px 14px',
              fontSize: 13.5,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ flex: 1 }} />

        {phase === 'celebrate' ? (
          celebrateCue ? (
            // Real independent/retry success: motion + sound lead, not a
            // sentence to read. The star (enlarged from its old 40px) and a
            // few restrained sparkles are the primary signal; praise is
            // small and secondary, present for sound-off/screen-reader
            // users but never the thing a child has to read to know they
            // succeeded.
            <div role="status" className="lc-fade-up lc-celebrate-beat" style={{ textAlign: 'center' }}>
              <span aria-hidden className="lc-success-pop" style={{ display: 'inline-block', position: 'relative' }}>
                <img src="/icons/success-star.png" alt="" style={{ height: 60, width: 'auto' }} />
                <span className="lc-sparkle lc-sparkle-1" aria-hidden />
                <span className="lc-sparkle lc-sparkle-2" aria-hidden />
                <span className="lc-sparkle lc-sparkle-3" aria-hidden />
              </span>
              <div className="lc-celebrate-praise">{praise}</div>
            </div>
          ) : (
            // Assisted rung-3 continuation: warm and neutral, never a
            // failure look, but deliberately no star/sparkle/sound — "no
            // pause, no second chance, no change in tone." Still needs a
            // wordless signal though: praise text alone left a pre-reader
            // with nothing to understand here (the old text-only version of
            // this beat). A small, static, Leaf-colored check — never the
            // star, never a bounce — says "that's fine, on we go" without
            // requiring the word next to it to be read.
            <div role="status" className="lc-fade-up" style={{ textAlign: 'center' }}>
              <QuietCheckIcon />
              <div className="lc-celebrate-praise lc-celebrate-praise-quiet">{praise}</div>
            </div>
          )
        ) : phase === 'correction' && speaking ? (
          // Rung 2/3's own TTS is playing (ambience already ducked by the
          // existing phase/speaking effect) — no action available yet, the
          // mic must not open until the line finishes. Same speaker glyph
          // + speaking-pulse language as the header's replay button, never
          // the raw 🔊 emoji character this used to be.
          <div aria-hidden className="lc-speaking-active" style={{ display: 'inline-flex', padding: '16px 0' }}>
            <SpeakerIcon size={26} color="var(--sky)" />
          </div>
        ) : phase === 'correction' && tricky && rung < 3 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            {/* Sliding/listening must visibly come before retrying aloud:
                whichever help interaction is showing (slider or audio), the
                mic button stays disabled until it finishes — never an
                equally-inviting choice sitting right next to it. "Keep
                going" is never gated — a child can always skip. */}
            <button
              className={helpDone ? 'btn-primary lc-help-pulse' : 'btn-primary'}
              disabled={!helpDone}
              aria-label={helpDone ? 'Try the word' : 'Finish the help first'}
              style={{
                background: 'var(--blue)',
                boxShadow: '0 3px 0 #054a8a',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                ...(helpDone ? null : { opacity: 0.4, cursor: 'default', boxShadow: 'none' }),
              }}
              onClick={() => {
                if (!helpDone) return;
                setPhase('scoring');
                void beginListening(tricky);
              }}
            >
              <MicIcon size={20} color="#fff" />
              Try the word
            </button>
            <button
              onClick={() => {
                // Neither read correctly nor read to the child — the honest
                // bucket is "assisted" (excluded), not "correct". See
                // docs/HELP_LADDER_INTEGRATION.md. Still checks the pending
                // queue: skipping THIS word must not silently skip the
                // others a multi-stumble page still owes a turn.
                pageAssistedRef.current = true;
                finishWordOrContinue('On we go!', false);
              }}
              style={{
                border: 0,
                background: 'rgba(255,253,248,0.85)',
                borderRadius: 999,
                boxShadow: '0 1px 4px rgba(43,43,43,0.12)',
                color: 'var(--ink-soft)',
                fontSize: 13.5,
                padding: '7px 16px',
                cursor: 'pointer',
              }}
            >
              Keep going →
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              if (phase === 'ready') {
                setPhase('scoring');
                void beginListening(page.text);
              } else if (phase === 'listening') {
                void finishListening();
              }
            }}
            disabled={phase === 'scoring'}
            aria-label={phase === 'listening' ? "I'm listening — tap when you're done" : 'Start reading'}
            style={{
              background: '#fffaf0',
              border: 0,
              borderRadius: 18,
              padding: '16px 18px',
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--leaf)',
              boxShadow: '0 4px 14px rgba(43,43,43,0.14)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              lineHeight: 1.7,
            }}
          >
            {phase === 'ready' ? (
              <span aria-hidden className="lc-invite-pulse" style={{ display: 'inline-block' }}>
                <MicIcon size={28} color="var(--leaf)" />
              </span>
            ) : phase === 'scoring' ? (
              <span aria-hidden className="lc-processing-spin" style={{ display: 'inline-block' }}>
                <img src="/icons/processing.png" alt="" style={{ height: 24, width: 'auto' }} />
              </span>
            ) : (
              <ListenBars active={phase === 'listening'} />
            )}
            {phase === 'ready' && 'Tap to read out loud!'}
            {phase === 'listening' && 'I’m listening…'}
            {phase === 'scoring' && (scoringSlow ? 'Still working on it…' : 'One moment…')}
          </button>
        )}

        {process.env.NODE_ENV === 'development' && phase === 'ready' && (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 10 }}>
            <button onClick={() => simulate('good')} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.5)', color: 'var(--ink-soft)' }}>
              sim: good
            </button>
            <button onClick={() => simulate('tricky')} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.5)', color: 'var(--ink-soft)' }}>
              sim: tricky
            </button>
            {LIVE_HIGHLIGHT && (
              <button onClick={simulateLive} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.5)', color: 'var(--ink-soft)' }}>
                sim: live
              </button>
            )}
            {/* Test-only: re-submits the SAME ?fixtureTake words again —
                the only way to deterministically drive
                handlePhraseFailure()'s retry-then-exhaust cycle without a
                real mic (its own retry reopens beginListening() for real,
                which fails fast with no mic/Azure available in a headless
                test run and lands back here on 'ready'). Only rendered
                once a fixtureTake has actually fired this session. */}
            {fixtureTakeWordsRef.current && (
              <button
                onClick={() => {
                  if (fixtureTakeWordsRef.current) simulateFixture(fixtureTakeWordsRef.current);
                }}
                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.5)', color: 'var(--ink-soft)' }}
              >
                sim: repeat fixture
              </button>
            )}
          </div>
        )}

        {/* Dev-only: exercise the ladder's retry rungs without a real mic
            take — same handleVerdicts() entry point as a real retry. */}
        {process.env.NODE_ENV === 'development' && phase === 'correction' && rung > 0 && rung < 3 && !speaking && (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 10 }}>
            <button onClick={() => simulateRetry('ok')} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.5)', color: 'var(--ink-soft)' }}>
              sim: retry ok
            </button>
            <button onClick={() => simulateRetry('stumble')} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.5)', color: 'var(--ink-soft)' }}>
              sim: retry stumble
            </button>
          </div>
        )}
      </main>
    </div>
    </div>
  );
}
