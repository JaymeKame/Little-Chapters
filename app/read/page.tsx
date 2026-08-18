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
  const [speaking, setSpeaking] = useState(false); // TTS replay of the current sentence — distinct from mic-listening
  const [sentenceLeaving, setSentenceLeaving] = useState(false); // brief out-transition before the next sentence mounts
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
    void requestTutorChapter(p).then((generated) => { if (generated) setChapter(generated); });
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
    celebrateAndAdvance();
  }

  function celebrateAndAdvance(successfulRead = true) {
    if (successfulRead) playReadingCue('section-success.mp3');
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
              <PageText text={page.text} focusWords={page.focusWords} />
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
          <div
            className="lc-fade-up"
            aria-label="Nice reading!"
            style={{ textAlign: 'center', fontSize: 15, fontWeight: 600, color: 'var(--leaf)', padding: '14px 0' }}
          >
            ✓ Nice reading!
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
              onClick={() => celebrateAndAdvance(false)}
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
          </div>
        )}
      </main>
    </div>
    </div>
  );
}
