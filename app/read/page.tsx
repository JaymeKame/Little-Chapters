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

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { usePet } from '@/components/PetCompanion';
import { SceneBackground } from '@/components/SceneBackground';
import { chapterFor, selectChapterScenes, type Chapter } from '@/lib/chapters';
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

/* Graded praise for the celebrate beat — always warm, never a failure state;
 * only the intensity tracks the result. */
const PRAISE = {
  top: ['Awesome reading!', 'Amazing!', 'Fantastic reading!'],
  great: ['Great reading!', 'Great job!'],
  good: ['Nice reading!', 'Good job!'],
} as const;

const pick = (arr: readonly string[]) => arr[Math.floor(Math.random() * arr.length)];

function praiseFor(accuracy: number, hadHelp: boolean): string {
  if (!hadHelp && accuracy >= 90) return pick(PRAISE.top);
  if (!hadHelp && accuracy >= 75) return pick(PRAISE.great);
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
 *  bold in the accessible reading blue (#075DAD). */
function PageText({ text, focusWords }: { text: string; focusWords: string[] }) {
  const lower = focusWords.map((w) => w.toLowerCase());
  const sentences = text.split(/(?<=[.!?])\s+/);
  return (
    <p className="lc-page-text">
      {sentences.map((sentence, si) => (
        <span key={si} className="lc-sentence">
          {sentence.split(/(\s+)/).map((tok, i) => {
            const clean = tok.toLowerCase().replace(/[^a-z']/g, '');
            return clean && lower.includes(clean) ? (
              <span key={i} className="lc-focus-word">
                {tok}
              </span>
            ) : (
              <span key={i}>{tok}</span>
            );
          })}
        </span>
      ))}
    </p>
  );
}

function ReadExperience() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const debug = searchParams.get('debug') === '1';
  // Dev-only handle to reach the real cliffhanger presentation without playing the whole chapter.
  const previewCliffhanger = process.env.NODE_ENV === 'development' && searchParams.get('preview') === 'cliffhanger';
  const { user } = useAuth();
  const pet = usePet(user?.uid ?? null);
  const [profile, setProfile] = useState<ChildProfile | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [tricky, setTricky] = useState<string | null>(null); // correction-state word
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false); // TTS replay of the current sentence — distinct from mic-listening
  const [sentenceLeaving, setSentenceLeaving] = useState(false); // brief out-transition before the next sentence mounts
  const [praise, setPraise] = useState('Nice reading!'); // graded celebrate-beat copy — set once per successful read
  const listeningCuePlayedRef = useRef(false);
  const sessionRef = useRef<ReadingSession | null>(null);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const practicedRef = useRef<Map<string, string>>(new Map());
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
    if (previewCliffhanger) setPhase('chapter-end');
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
  const scenes = selectChapterScenes(chapter.id, profile.interests);
  const sceneBg = scenes.reading; // cliffhanger reuses this — never a separate pick

  function replayCurrentSentence() {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    speakPrompt(tricky ?? page.text, { onEnd: () => setSpeaking(false) });
  }

  function armSilenceStop() {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    // Must exceed Azure's 2.2 s segmentation pause, and gets re-armed by every
    // partial transcript — so it measures silence since the child last SPOKE,
    // not since the last finalized segment. A 5-year-old's mid-page thinking
    // pause must never cut the mic while they're still reading.
    silenceTimer.current = setTimeout(() => void finishListening(), 3000);
  }

  async function beginListening(referenceText: string) {
    setError(null);
    stopSpeaking();
    setSpeaking(false);
    duckAmbience();
    listeningCuePlayedRef.current = true;
    playListeningStart();
    try {
      const authToken = user ? await user.getIdToken() : null;
      const session = await startReadingSession({
        referenceText,
        authToken,
        onStatus: (s) => {
          if (disposedRef.current) return;
          if (s === 'listening') {
            setPhase('listening');
          }
          if (s === 'error' && sessionRef.current) void finishListening();
        },
        onPartialTranscript: () => armSilenceStop(), // active speech keeps postponing the stop
        onSegment: () => armSilenceStop(), // a finalized burst also counts
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
    setPraise(praiseFor(r.scores.accuracy, attemptRef.current > 0));
    celebrateAndAdvance();
  }

  function celebrateAndAdvance(successfulRead = true) {
    if (successfulRead) playReadingCue('section-success.mp3');
    else setPraise(pick(PRAISE.good)); // neutral "keep going" skip — still warm, no success cue
    setPhase('celebrate');
    setTimeout(() => {
      if (!disposedRef.current) advance();
    }, 1300);
  }

  function advance() {
    setSentenceLeaving(true);
    setTimeout(() => {
      if (disposedRef.current) return;
      setTricky(null);
      attemptRef.current = 0;
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

  /* ── Screen 5: chapter end ── */
  if (phase === 'chapter-end') {
    return (
      <div className="scene lc-cliff" style={{ position: 'relative' }}>
        <SceneBackground src={sceneBg} cliff />
        <div className="screen lc-scene-content lc-cliff-shell">
          <header className="lc-top-controls lc-cliff-header">
            <button className="icon-btn" aria-label="Home" onClick={() => router.push('/home')}>
              🏠
            </button>
            <button className="icon-btn" aria-label="Read aloud">
              🔊
            </button>
          </header>
          <main className="lc-cliff-main">
            <p className="lc-cliff-complete">You finished today&rsquo;s chapter.</p>
            <p className="lc-cliff-copy">{chapter.cliffhanger[0]}</p>
            <p className="lc-cliff-return">Come back tomorrow to see what happens next.</p>
            <p className="lc-cliff-continue">{chapter.cliffhanger[1]}</p>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="scene lc-scenic lc-reading-scene" style={{ position: 'relative' }}>
      <SceneBackground src={sceneBg} />
      <div className="screen lc-scene-content lc-reading-shell">
        <header className="lc-top-controls lc-reading-header">
          <button
            className="icon-btn"
            aria-label="Close"
            onClick={() => {
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
          <button
            className="icon-btn"
            aria-label={speaking ? 'Stop reading aloud' : 'Read aloud'}
            onClick={() => {
              playHomeSound('replay.mp3');
              replayCurrentSentence();
            }}
          >
            {speaking ? '🔇' : '🔊'}
          </button>
        </header>

        <main className="lc-reading-main">
          <div className="lc-reading-stack">
            <div className={`lc-reading-card-in${phase === 'celebrate' ? ' lc-section-success' : ''} lc-reading-card`}>
              {tricky ? (
                <div className="lc-help-pulse lc-tricky-wrap">
                  <p className="lc-tricky-label">Let&rsquo;s try that word together.</p>
                  <p className="lc-tricky-word">{tricky}</p>
                  <div aria-hidden className="lc-tricky-dots">• • •</div>
                </div>
              ) : (
                <div key={pageIdx} className={sentenceLeaving ? 'lc-sentence-out' : 'lc-sentence-in'}>
                  <PageText text={page.text} focusWords={page.focusWords} />
                </div>
              )}
              <div aria-hidden className="lc-page-dots">
                {chapter.pages.map((_, i) => (
                  <span key={i} className={i === pageIdx ? 'is-current' : ''}>
                    {i === pageIdx ? '●' : '○'}
                  </span>
                ))}
              </div>
            </div>

            {error && <div className="lc-reading-error">{error}</div>}

            {phase === 'celebrate' ? (
              <div className="lc-fade-up lc-reading-praise" aria-label={praise}>
                ✓ {praise}
              </div>
            ) : phase === 'correction' && tricky ? (
              <div className="lc-reading-actions">
                <button
                  className="btn-primary lc-reading-primary"
                  onClick={() => {
                    setPhase('scoring');
                    void beginListening(tricky);
                  }}
                >
                  Try the word
                </button>
                <button className="btn-primary lc-reading-secondary" onClick={() => celebrateAndAdvance(false)}>
                  Keep going →
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  if (phase === 'ready') {
                    setPhase('listening');
                    void beginListening(page.text);
                  } else if (phase === 'listening') {
                    void finishListening();
                  }
                }}
                disabled={phase === 'scoring'}
                aria-label={phase === 'listening' ? "I'm listening — tap when you're done" : 'Start reading'}
                className="lc-listen-btn"
              >
                <ListenBars active={phase === 'listening'} />
                <span>{phase === 'ready' && 'Tap to read aloud'}</span>
                <span>{phase === 'listening' && 'I’m listening…'}</span>
                <span>{phase === 'scoring' && 'One moment…'}</span>
              </button>
            )}
          </div>

          {process.env.NODE_ENV === 'development' && debug && phase === 'ready' && (
            <div className="lc-dev-sim">
              <button onClick={() => simulate('good')}>sim: good</button>
              <button onClick={() => simulate('tricky')}>sim: tricky</button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default function ReadPage() {
  return (
    <Suspense fallback={<div className="scene lc-reading-scene" />}>
      <ReadExperience />
    </Suspense>
  );
}
