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
import { chapterFor, requestTutorChapter, selectStoryScene, type Chapter } from '@/lib/chapters';
import { createLiveProgress, type LiveProgress } from '@/lib/live-progress';
import { loadProfile, saveReport, type ChildProfile } from '@/lib/profile';
import {
  startReadingSession,
  type ReadingAssessmentResult,
  type ReadingSession,
} from '@/lib/pronunciation';
import { combineVerdicts, type DecodeResult, type WordVerdict } from '@/lib/reading-verdict';
import {
  duckAmbience,
  playCliffhanger,
  playListeningStart,
  playReadingCue,
  playHomeSound,
  playTheme,
  prepareStoryAudio,
  restoreAmbience,
  speakPrompt,
  stopAmbience,
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
  const { user } = useAuth();
  const pet = usePet(user?.uid ?? null);
  const [profile, setProfile] = useState<ChildProfile | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [tricky, setTricky] = useState<string | null>(null); // correction-state word
  const [error, setError] = useState<string | null>(null);
  const [readCount, setReadCount] = useState(0); // live karaoke highlight cursor
  const [praise, setPraise] = useState('Great reading!');
  const [speaking, setSpeaking] = useState(false); // TTS replay of the current sentence — distinct from mic-listening
  const [sentenceLeaving, setSentenceLeaving] = useState(false); // brief out-transition before the next sentence mounts
  const liveRef = useRef<LiveProgress | null>(null);
  const listeningCuePlayedRef = useRef(false);
  const sessionRef = useRef<ReadingSession | null>(null);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const practicedRef = useRef<Map<string, string>>(new Map());
  const startedReadingRef = useRef(false); // once true, never swap the chapter text
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    const p = loadProfile();
    if (!p) {
      router.replace('/');
      return;
    }
    setProfile(p);
    setChapter(chapterFor(p.interests[0], p.childName));
    // Upgrade to a stage-matched reading-tutor chapter when one is available
    // (cached from earlier today, or freshly generated when OPENAI_API_KEY is
    // configured server-side). Never swap once the child has started reading;
    // without the key the request 503s instantly and the demo arc stays.
    void requestTutorChapter(p).then((tutorChapter) => {
      if (tutorChapter && !disposedRef.current && !startedReadingRef.current) setChapter(tutorChapter);
    });
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

  // Reuse the same flat story theme as Home; the controller prevents duplicate loops.
  useEffect(() => {
    if (profile) {
      prepareStoryAudio(themeAssetFor(profile.interests[0]));
      playTheme();
    }
    return () => stopAmbience();
  }, [profile]);

  useEffect(() => {
    if (phase === 'listening' || phase === 'scoring' || speaking) duckAmbience();
    else restoreAmbience();
  }, [phase, speaking]);

  useEffect(() => {
    if (phase === 'chapter-end') playCliffhanger();
  }, [phase]);

  if (!profile || !chapter) return <div className="screen" />;
  const page = chapter.pages[pageIdx];
  const sceneBg = selectStoryScene(chapter.id, profile.interests);

  function replayCurrentSentence() {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
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
    listeningCuePlayedRef.current = false;
    try {
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
          armSilenceStop(liveRef.current && n >= liveRef.current.total ? 1000 : 3000);
        },
        onSegment: (words) => {
          if (disposedRef.current) return;
          const n = liveRef.current ? liveRef.current.segment(words.map((w) => w.word)) : 0;
          if (LIVE_HIGHLIGHT) setReadCount(n);
          armSilenceStop(liveRef.current && n >= liveRef.current.total ? 1000 : 3000);
        },
      });
      if (disposedRef.current) {
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
        attemptRef.current = 0; // a dead retry-take must not leave correction disabled
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
        attemptRef.current = 0;
        setTricky(null);
        setError("The connection dropped — let's try that page again!");
      }
      return;
    }
    if (disposedRef.current) return;
    try {
      const verdicts = await decode(result);
      if (disposedRef.current) return;
      handleVerdicts(result, verdicts);
    } catch {
      if (!disposedRef.current) advance(); // scoring hiccup on a real read — never strand the child
    }
  }

  async function decode(r: ReadingAssessmentResult): Promise<WordVerdict[]> {
    if (!r.audioWav || r.words.length === 0) return combineVerdicts(r.words, null);
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
      return combineVerdicts(r.words, (await res.json()) as DecodeResult);
    } catch {
      return combineVerdicts(r.words, null);
    }
  }

  function handleVerdicts(r: ReadingAssessmentResult, verdicts: WordVerdict[]) {
    const flagged = verdicts.filter((v) => v.needsHelp);
    if (attemptRef.current === 0) {
      // Award once per page — the word-retry take is practice, not a reading.
      pet.awardReading({
        accuracy: r.scores.accuracy,
        wordCount: r.words.filter((w) => w.errorType !== 'Insertion').length,
        flaggedCount: flagged.length,
      });
    }
    if (flagged.length > 0 && attemptRef.current === 0) {
      const word = flagged[0].word;
      practicedRef.current.set(word, `the word “${word}” — worth a little practice together`);
      attemptRef.current = 1;
      setTricky(word);
      setPhase('correction');
      return;
    }
    // Retry take: the praise rewards the effort, not the original stumble.
    celebrateAndAdvance(attemptRef.current > 0 ? 'You did it!' : praiseFor(r.scores.accuracy, flagged.length));
  }

  function celebrateAndAdvance(p: string, cue = true) {
    setPraise(p);
    if (cue) playReadingCue('section-success.mp3');
    setPhase('celebrate');
    setTimeout(() => {
      if (!disposedRef.current) advance();
    }, 1600);
  }

  function advance() {
    setSentenceLeaving(true);
    setTimeout(() => {
      if (disposedRef.current) return;
      setTricky(null);
      attemptRef.current = 0;
      liveRef.current = null;
      setReadCount(0);
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
    saveReport({
      date: new Date().toLocaleDateString('en-CA'), // local YYYY-MM-DD, not UTC
      childName: profile!.childName,
      newWords: c.pages.flatMap((p) => p.focusWords).filter((w) => w !== c.character),
      // Words the child actually struggled with come FIRST so they survive the
      // parent screen's top-3 slice; generic chapter phonics fill the rest.
      practiced: [...practicedRef.current.entries()]
        .map(([word, hint]) => ({ word, hint }))
        .concat(c.phonics.map((ph) => ({ word: ph.words[0], hint: ph.hint }))),
      teaser: c.teaser,
    });
    setPhase('chapter-end');
  }

  /* Dev-only shortcut so the whole flow is testable without a microphone. */
  function simulate(kind: 'good' | 'tricky') {
    startedReadingRef.current = true; // sims count as reading — no chapter swaps mid-flow
    const words = page.text.split(/\s+/).map((t) => t.toLowerCase().replace(/[^a-z']/g, '')).filter(Boolean);
    const fakeResult = {
      scores: { pronunciation: 90, accuracy: kind === 'good' ? 94 : 70, fluency: 90, completeness: 100, prosody: 80 },
      words: words.map((w) => ({ word: w, accuracy: 95, errorType: 'None', offsetMs: 0, durationMs: 300, phonemes: [{ phoneme: 'ə', accuracy: kind === 'good' ? 95 : 30 }] })),
    } as unknown as ReadingAssessmentResult;
    const verdicts = words.map((w, i) => ({
      word: w, errorType: 'None', azureAccuracy: 95, azureMinPhoneme: 95,
      decodeScore: null, decodeHeard: null,
      needsHelp: kind === 'tricky' && i === words.length - 1, reason: null,
    })) as WordVerdict[];
    handleVerdicts(fakeResult, verdicts);
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
        <header className="lc-top-controls" style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 18px' }}>
          <button className="icon-btn" aria-label="Home" onClick={() => router.push('/home')}>
            🏠
          </button>
          <button className="icon-btn" aria-label="Read aloud">
            🔊
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
    <div className="scene lc-scenic lc-reading-scene" style={{ position: 'relative' }}>
    <SceneBackground src={sceneBg} />
    <div className="screen lc-scene-content">
      <header className="lc-top-controls" style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 18px' }}>
        <button
          className="icon-btn"
          aria-label="Close"
          onClick={() => {
            // Full teardown BEFORE navigating: a still-resolving session or a
            // pending silence timer must not resurrect the flow mid-exit.
            disposedRef.current = true;
            if (silenceTimer.current) clearTimeout(silenceTimer.current);
            sessionRef.current?.cancel();
            sessionRef.current = null;
            playHomeSound('close.mp3');
            router.push('/home');
          }}
        >
          ✕
        </button>
        <button className="icon-btn" aria-label={speaking ? 'Stop reading aloud' : 'Read aloud'} onClick={() => { playHomeSound('replay.mp3'); replayCurrentSentence(); }}>
          {speaking ? '🔇' : '🔊'}
        </button>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '4px 22px 26px' }}>
        <div
          className={`lc-reading-card-in${phase === 'celebrate' ? ' lc-section-success' : ''}`}
          style={{
            background: '#fffdf8',
            borderRadius: 18,
            padding: '26px 24px 18px',
            boxShadow: '0 6px 20px rgba(43,43,43,0.16)',
          }}
        >
          {/* Keep the big word visible through the retry's listening/scoring —
              hiding it the moment the child taps "Try the word" defeats it. */}
          {tricky ? (
            <div className="lc-help-pulse" style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 15, color: 'var(--ink-soft)', margin: '0 0 14px' }}>
                Let&rsquo;s try that word together.
              </p>
              <p className="lc-tricky-word">{tricky}</p>
              <div aria-hidden style={{ color: 'var(--sky)', letterSpacing: 4, fontSize: 20, marginBottom: 8 }}>
                • • •
              </div>
            </div>
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
            <div aria-hidden style={{ fontSize: 36 }}>
              🎉
            </div>
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
        ) : phase === 'correction' && tricky ? (
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn-primary"
              style={{ background: 'var(--blue)', boxShadow: '0 3px 0 #054a8a', flex: 1 }}
              onClick={() => {
                setPhase('scoring');
                void beginListening(tricky);
              }}
            >
              🎙️ Try the word
            </button>
            <button
              className="btn-primary"
              style={{ flex: 1 }}
              onClick={() => celebrateAndAdvance('On we go!', false)}
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
            <ListenBars active={phase === 'listening'} />
            {phase === 'ready' && 'Tap, then read the page out loud!'}
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
      </main>
    </div>
    </div>
  );
}
