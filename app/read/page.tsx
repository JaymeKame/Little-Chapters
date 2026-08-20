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
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { usePet } from '@/components/PetCompanion';
import { SceneBackground } from '@/components/SceneBackground';
import { SlideWordHelp } from '@/components/SlideWordHelp';
import { chapterFor, requestTutorChapter, selectStoryScene, stageForAge, type Chapter } from '@/lib/chapters';
import { appendChapterHistoryEntry } from '@/lib/chapter-history';
import { createLiveProgress, type LiveProgress } from '@/lib/live-progress';
import { loadProfile, saveReport, type ChildProfile } from '@/lib/profile';
import {
  startReadingSession,
  type ReadingAssessmentResult,
  type ReadingSession,
} from '@/lib/pronunciation';
import { combineVerdicts, type DecodeResult, type WordVerdict } from '@/lib/reading-verdict';
import { toWordSignals } from '@/lib/reading-signal-adapter';
import type { SessionIntervention } from '@/lib/reading-session-interpreter';
import { HELP_LADDER, rungLine, pickEncouragement, segmentWord } from '@/lib/help-ladder';
import {
  defaultProgressFor,
  loadLocalProgress,
  completeSessionLocally,
  fetchRemoteProgress,
  completeSessionRemote,
  reconcileProgress,
} from '@/lib/child-progress';
import type { ChildProgress, SentenceResult, SessionInput, WordSignal } from '@/reading-tutor/src/types';
import {
  duckAmbience,
  pauseForBackground,
  playCliffhanger,
  playListeningStart,
  playReadingCue,
  playHomeSound,
  playTheme,
  prepareStoryAudio,
  restoreAmbience,
  resumeMusic,
  speakPrompt,
  stopMusic,
  stopSpeaking,
  stopTheme,
  themeAssetFor,
} from '@/lib/audio';

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
    if (w && segmentWord(w, stage)) return w;
  }
  return null;
}

/* Scene background: the SAME real curated story scene selection as Screen 3
 * (lib/chapters.ts selectStoryScene — interest-aware, stable per chapter.id)
 * → .lc-scenic/.lc-cliff gradient. The automatic AI-generation path remains
 * intentionally unused here — see lib/chapters.ts requestChapterVisuals. */

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

export default function ReadPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const pet = usePet(authLoading ? undefined : (user?.uid ?? null));
  const [profile, setProfile] = useState<ChildProfile | null>(null);
  const [progress, setProgress] = useState<ChildProgress | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [tricky, setTricky] = useState<string | null>(null); // correction-state word
  const [error, setError] = useState<string | null>(null);
  const [readCount, setReadCount] = useState(0); // live karaoke highlight cursor
  const [praise, setPraise] = useState('Great reading!');
  const [speaking, setSpeaking] = useState(false); // TTS replay of the current sentence — distinct from mic-listening
  const [sentenceLeaving, setSentenceLeaving] = useState(false); // brief out-transition before the next sentence mounts
  const [rung, setRung] = useState<0 | 1 | 2 | 3>(0); // help-ladder rung for the current `tricky` word (0 = not in the ladder)
  // Gates the mic-retry button while a segmentable word's slide interaction
  // is in progress: false the moment a new tricky word enters the ladder,
  // true only once the child has slid through every grapheme AND heard the
  // whole-word blend — sliding must visibly come before retrying aloud.
  // Irrelevant (button always enabled) for a word with no slideSegments.
  const [slideDone, setSlideDone] = useState(false);
  const liveRef = useRef<LiveProgress | null>(null);
  const listeningCuePlayedRef = useRef(false);
  const sessionRef = useRef<ReadingSession | null>(null);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rungRef = useRef<0 | 1 | 2 | 3>(0); // logic source of truth; `rung` state above mirrors it for render
  const awardedRef = useRef(false); // XP granted for the CURRENT page (survives retry-take errors)
  const practicedRef = useRef<Map<string, string>>(new Map());
  const startedReadingRef = useRef(false); // once true, never swap the chapter text
  const disposedRef = useRef(false);

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
    // Unauthenticated early attempt (no uid yet — auth hasn't settled at
    // mount) — in production this 401s and is swallowed, same as always;
    // the auth-gated effect below does the real, correctly-staged fetch.
    void requestTutorChapter(p, null).then((generated) => { if (generated) setChapter(generated); });
    return () => {
      disposedRef.current = true;
      sessionRef.current?.cancel();
      sessionRef.current = null;
      stopSpeaking();
      stopTheme();
      stopMusic();
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
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, user, authLoading]);

  // Reuse the same flat story theme as Home; the controller prevents duplicate loops.
  // Owns theme for as long as this effect's chapter/profile identity holds —
  // cleanup must stop the SAME track it started. This previously called
  // stopAmbience() (a different, unused track), so theme never actually
  // stopped via this path; it only stopped incidentally via the mount
  // effect's own (correct) stopTheme() below, which fires at the same
  // unmount moment. Both now agree, redundantly but harmlessly.
  useEffect(() => {
    if (profile) {
      prepareStoryAudio(themeAssetFor(profile.interests[0]));
      playTheme();
    }
    return () => stopTheme();
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
      stopTheme();
    } else if (phase === 'listening' || phase === 'scoring' || phase === 'correction' || speaking) {
      duckAmbience();
    } else {
      restoreAmbience();
    }
  }, [phase, speaking]);

  useEffect(() => {
    if (phase === 'chapter-end') playCliffhanger();
  }, [phase]);

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
        pauseForBackground();
      } else if (phase === 'chapter-end') {
        resumeMusic();
      } else {
        playTheme();
      }
    }
    function onPageHide() {
      stopSpeaking();
      stopTheme();
      stopMusic();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [phase]);

  if (!profile || !chapter) return <div className="screen" />;
  const page = chapter.pages[pageIdx];
  const sceneBg = selectStoryScene(chapter.id, profile.interests);
  // Computed for the current tricky word at ANY rung < 3, not just rung 2:
  // with the escalation remap below, a segmentable word now shows the slide
  // interaction at rung 1 (the first stumble) and never actually visits
  // rung 2 again — rung 2's bare-word reveal is reserved for words that
  // don't cleanly segment. Null whenever segmentWord() can't cover the word
  // with graphemes this child is actually expected to know yet, in which
  // case the plain phoneme/word reveal below is used exactly as it worked
  // before this feature existed.
  const slideSegments = tricky && rung < 3 ? segmentWord(tricky, stage) : null;

  function replayCurrentSentence() {
    // Never speak the reference text while the mic is live — the recognizer
    // would score the TTS voice as the child's reading (echo cancellation
    // does not reliably remove OS-level TTS from the mic signal). Disabled
    // during 'correction' entirely (see header button below) so this can
    // never race a ladder-driven rung 2/3 utterance.
    if (sessionRef.current || phase === 'listening' || phase === 'scoring') return;
    if (speaking) {
      stopSpeaking();
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
    duckAmbience();
    setSpeaking(true);
    speakPrompt(tricky ?? page.text, { onEnd: () => setSpeaking(false) });
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
    stopSpeaking();
    setSpeaking(false);
    // Duck synchronously — the caller already set phase to 'scoring'/mic
    // setup starts this same tick, ahead of the [phase,speaking] effect's
    // next-render pass. Mic setup can take real time (network/SDK), so this
    // also keeps theme quiet through the "One moment…" wait, not just once
    // Azure's onStatus('listening') callback eventually fires.
    duckAmbience();
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
          setError("That took too long to get ready — let's try again!");
        }
      }, 20_000);
      const authToken = user ? await user.getIdToken() : null;
      const session = await startReadingSession({
        referenceText,
        authToken,
        onStatus: (s) => {
          if (disposedRef.current) return;
          if (s === 'listening') {
            setPhase('listening');
            if (!listeningCuePlayedRef.current) {
              listeningCuePlayedRef.current = true;
              playListeningStart();
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
    if (!r.audioWav || r.words.length === 0) return { verdicts: combineVerdicts(r.words, null), decode: null };
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
      return { verdicts: combineVerdicts(r.words, decodeResult), decode: decodeResult };
    } catch {
      return { verdicts: combineVerdicts(r.words, null), decode: null };
    }
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

  /** One rung up from wherever the ladder currently is for this page. Rungs
   *  1/2 show a cue and offer one more mic attempt; rung 3 reads the whole
   *  sentence aloud and marks the page assisted — see
   *  docs/HELP_LADDER_INTEGRATION.md and reading-tutor/content/config.json
   *  help_template. */
  function enterOrEscalateLadder(word: string) {
    // A word already shown the slide interaction at rung 1 that still needs
    // help skips the old bare-word rung 2 reveal entirely — the slider
    // already showed every letter, so rung 2 would teach nothing new.
    // Escalate straight to rung 3's sentence fallback instead ("if still
    // struggling, escalate to the remaining stronger help"). Words that
    // don't segment keep the original 1 -> 2 -> 3 progression untouched.
    const skipToSentenceFallback = rungRef.current === 1 && segmentWord(word, stage) !== null;
    const next: 1 | 2 | 3 = skipToSentenceFallback ? 3 : (Math.min(3, rungRef.current + 1) as 1 | 2 | 3);
    rungRef.current = next;
    setRung(next);
    setTricky(word);
    setSlideDone(false);
    practicedRef.current.set(word, `the word “${word}” — worth a little practice together`);
    setPhase('correction');
    duckAmbience(); // synchronous — see replayCurrentSentence()'s note on why; every rung ducks now, not just the speaking ones
    if (next === 2) {
      setSpeaking(true);
      speakPrompt(rungLine(2, { word, sentence: page.text, stage }), {
        onEnd: () => { if (!disposedRef.current) setSpeaking(false); },
      });
    } else if (next === 3) {
      pageAssistedRef.current = true;
      setSpeaking(true);
      speakPrompt(rungLine(3, { word, sentence: page.text, stage }), {
        onEnd: () => {
          if (disposedRef.current) return;
          setSpeaking(false);
          // "no pause, no second chance, no change in tone" — the same
          // no-fanfare advance the manual skip button already uses, never
          // the celebratory cue.
          celebrateAndAdvance(pickEncouragement(), false);
        },
      });
    }
  }

  function handleVerdicts(r: ReadingAssessmentResult, verdicts: WordVerdict[], decodeResult: DecodeResult | null) {
    const flagged = verdicts.filter((v) => v.needsHelp);
    if (rungRef.current === 0) storePageSignals(r.words, decodeResult);
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
    // Retry take: the praise rewards the effort, not the original stumble.
    celebrateAndAdvance(rungRef.current > 0 ? 'You did it!' : praiseFor(r.scores.accuracy, flagged.length));
  }

  function celebrateAndAdvance(p: string, cue = true) {
    // Clear the correction card immediately — otherwise it lingers behind
    // the celebrate star/text until advance() fires 1600ms later, showing
    // two states' UI at once (the correction card was only ever meant to
    // survive through the RETRY's listening/scoring, not into celebrate).
    setTricky(null);
    setPraise(p);
    if (cue) playReadingCue('section-success.mp3');
    setPhase('celebrate');
    setTimeout(() => {
      if (!disposedRef.current) advance();
    }, 1600);
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
      liveRef.current = null;
      setReadCount(0);
      pageSignalsRef.current = null;
      pageInterventionsRef.current = null;
      pageAssistedRef.current = false;
      pageRereadRef.current = false;
      if (pageIdx + 1 < chapter!.pages.length) {
        playReadingCue('page-turn.mp3');
        setPageIdx((i) => i + 1);
        setPhase('ready');
      } else {
        finishChapter();
      }
      setSentenceLeaving(false);
    }, 140);
  }

  function finishChapter() {
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
    if (user && !user.isAnonymous) {
      void (async () => {
        try {
          const authToken = await user.getIdToken();
          await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({
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

  /* ── Screen 5: chapter end ── */
  if (phase === 'chapter-end') {
    return (
      <div className="scene lc-cliff" style={{ position: 'relative' }}>
      <SceneBackground src={sceneBg} cliff />
      <div className="screen lc-scene-content">
        <header className="lc-top-controls" style={{ display: 'flex', padding: '16px 18px' }}>
          <button
            className="icon-btn"
            aria-label="Home"
            onClick={() => {
              // Immediate: the cliffhanger cue (playMusic) may still be
              // playing — cut it the instant the child taps, not a
              // navigation-tick later. Unmount cleanup also stops it;
              // harmless overlap.
              stopMusic();
              router.push('/home');
            }}
          >
            <img src="/icons/home.png" alt="" style={{ height: 24, width: 'auto' }} />
          </button>
        </header>
        <main
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            alignItems: 'center',
            textAlign: 'center',
            padding: '0 34px 70px',
          }}
        >
          <p className="lc-cliff-copy"
            style={{
              fontFamily: 'var(--serif)',
              fontStyle: 'italic',
              fontSize: 20,
              lineHeight: 1.5,
              color: 'var(--sunshine)',
              textShadow: '0 1px 8px rgba(43,43,43,0.45)',
              margin: '0 0 18px',
            }}
          >
            {chapter.cliffhanger[0]}
          </p>
          <p className="lc-cliff-continue"
            style={{
              fontFamily: 'var(--serif)',
              fontSize: 30,
              lineHeight: 1.3,
              color: 'var(--sunshine)',
              textShadow: '0 1px 8px rgba(43,43,43,0.5)',
              margin: 0,
            }}
          >
            {chapter.cliffhanger[1]}
          </p>
          <div aria-hidden style={{ marginTop: 26, fontSize: 22, color: 'var(--sunshine)' }}>
            ✦
          </div>

          {/* Account creation prompt after free chapter */}
          <div
            style={{
              marginTop: 40,
              background: 'rgba(255,255,255,0.95)',
              borderRadius: 16,
              padding: '20px 24px',
              maxWidth: 320,
              boxShadow: '0 4px 16px rgba(43,43,43,0.15)',
            }}
          >
            <p style={{ fontFamily: 'var(--serif)', fontSize: 16, margin: '0 0 12px', color: 'var(--ink)' }}>
              Great job on the first chapter!
            </p>
            <p style={{ fontSize: 14, margin: '0 0 16px', color: 'var(--ink-soft)', lineHeight: 1.5 }}>
              Create an account to get daily progress updates via SMS with specific wins from each reading session.
            </p>
            <button
              onClick={() => router.push('/register')}
              className="btn-primary"
              style={{
                width: '100%',
                padding: '12px',
                fontSize: 15,
                fontWeight: 600,
                borderRadius: 10,
                border: 0,
                background: 'var(--leaf)',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Create Free Account
            </button>
            <button
              onClick={() => router.push('/home')}
              style={{
                width: '100%',
                padding: '10px',
                fontSize: 13,
                marginTop: 8,
                borderRadius: 10,
                border: 0,
                background: 'transparent',
                color: 'var(--ink-soft)',
                cursor: 'pointer',
              }}
            >
              Maybe Later
            </button>
          </div>
        </main>
      </div>
      </div>
    );
  }

  /* ── Screen 4: reading ── */
  return (
    <div className={`scene lc-scenic lc-reading-scene${phase === 'listening' ? ' lc-listening' : ''}`} style={{ position: 'relative' }}>
    <SceneBackground src={sceneBg} />
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
            stopSpeaking();
            stopTheme();
            playHomeSound('close.mp3');
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
            playHomeSound('replay.mp3');
            replayCurrentSentence();
          }}
        >
          <img src="/icons/speaker-audio.png" alt="" style={{ height: 22, width: 'auto' }} />
        </button>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '4px 22px 26px' }}>
        <div
          className="lc-reading-card-in"
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
              // segmentable word — no phoneme-cue line above it (that was
              // rung 1's old withhold-the-word text; showing every letter
              // and withholding the sound cue at once would be a mixed
              // message) and no competing dots/decoration, so the word and
              // the track are the only things on the card.
              <SlideWordHelp
                word={tricky}
                segments={slideSegments}
                onComplete={() => {
                  setSpeaking(true);
                  speakPrompt(tricky, {
                    onEnd: () => {
                      if (disposedRef.current) return;
                      setSpeaking(false);
                      // Only NOW is it "the child's turn" — the mic button
                      // stays disabled until the blended word has actually
                      // finished playing, so sliding + hearing the blend
                      // visibly precedes retrying aloud.
                      setSlideDone(true);
                    },
                  });
                }}
              />
            ) : (
              <div className="lc-help-pulse" style={{ textAlign: 'center' }}>
                {/* segmentWord() couldn't cleanly cover this word with
                    graphemes the child is actually expected to know at this
                    stage — never guess; fall back to the original ladder
                    exactly as it worked before this feature existed. */}
                <p style={{ fontSize: 15, color: 'var(--ink-soft)', margin: '0 0 14px' }}>
                  {rungLine(rung as 1 | 2, { word: tricky, sentence: page.text, stage })}
                </p>
                {rung >= 2 && <p className="lc-tricky-word">{tricky}</p>}
                <div aria-hidden style={{ color: 'var(--sky)', letterSpacing: 4, fontSize: 20, marginBottom: 8 }}>
                  • • •
                </div>
              </div>
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
          <div role="status" className="lc-fade-up" style={{ textAlign: 'center' }}>
            <span aria-hidden className="lc-success-pop" style={{ display: 'inline-block' }}>
              <img src="/icons/success-star.png" alt="" style={{ height: 40, width: 'auto' }} />
            </span>
            <div
              style={{
                fontFamily: 'var(--serif)',
                fontSize: 34,
                fontWeight: 700,
                color: 'var(--dark)',
                textShadow: '0 1px 0 rgba(255,255,255,0.55)',
                marginTop: 4,
              }}
            >
              {praise}
            </div>
          </div>
        ) : phase === 'correction' && speaking ? (
          // Rung 2/3's own TTS is playing (ambience already ducked by the
          // existing phase/speaking effect) — no action available yet, the
          // mic must not open until the line finishes.
          <div aria-hidden style={{ textAlign: 'center', fontSize: 22, color: 'var(--sky)', padding: '16px 0' }}>
            🔊
          </div>
        ) : phase === 'correction' && tricky && rung < 3 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            {/* Sliding must visibly come before retrying aloud: while a
                segmentable word's slider hasn't been completed yet, the mic
                button is disabled rather than an equally-inviting choice
                sitting right next to the track. "Keep going" is never
                gated — a child can always skip, slid or not. */}
            <button
              className={slideSegments && !slideDone ? 'btn-primary' : 'btn-primary lc-help-pulse'}
              disabled={!!slideSegments && !slideDone}
              aria-label={slideSegments && !slideDone ? 'Slide through the word first' : 'Try the word'}
              style={{
                background: 'var(--blue)',
                boxShadow: '0 3px 0 #054a8a',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                ...(slideSegments && !slideDone ? { opacity: 0.4, cursor: 'default', boxShadow: 'none' } : null),
              }}
              onClick={() => {
                if (slideSegments && !slideDone) return;
                setPhase('scoring');
                void beginListening(tricky);
              }}
            >
              <img src="/icons/mic-listening.png" alt="" style={{ height: 20, width: 'auto' }} />
              Try the word
            </button>
            <button
              onClick={() => {
                // Neither read correctly nor read to the child — the honest
                // bucket is "assisted" (excluded), not "correct". See
                // docs/HELP_LADDER_INTEGRATION.md.
                pageAssistedRef.current = true;
                celebrateAndAdvance('On we go!', false);
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
                <img src="/icons/mic-listening.png" alt="" style={{ height: 28, width: 'auto' }} />
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
            {phase === 'scoring' && 'One moment…'}
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
