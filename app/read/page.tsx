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
import { chapterFor, type Chapter } from '@/lib/chapters';
import { loadProfile, saveReport, type ChildProfile } from '@/lib/profile';
import {
  startReadingSession,
  type ReadingAssessmentResult,
  type ReadingSession,
} from '@/lib/pronunciation';
import { combineVerdicts, type DecodeResult, type WordVerdict } from '@/lib/reading-verdict';

type Phase = 'ready' | 'listening' | 'scoring' | 'correction' | 'celebrate' | 'chapter-end';

const SCENES: Record<string, string> = {
  dogs: 'linear-gradient(180deg, #bfe0f5 0%, #d8ecc8 45%, #a9cf94 100%)',
  space: 'linear-gradient(180deg, #1d2a52 0%, #3a4a7c 60%, #56679c 100%)',
  dinosaurs: 'linear-gradient(180deg, #cfe8cf 0%, #a8d0a0 55%, #7fb27d 100%)',
  trains: 'linear-gradient(180deg, #cfe4f2 0%, #e3d9c4 55%, #c9b489 100%)',
  unicorns: 'linear-gradient(180deg, #f3d9ef 0%, #dcd2f2 55%, #b8c8ee 100%)',
  ocean: 'linear-gradient(180deg, #bfe4f0 0%, #8fc8e6 55%, #5aa6d4 100%)',
};

function Waveform({ active }: { active: boolean }) {
  return (
    <span aria-hidden style={{ display: 'inline-flex', gap: 2.5, alignItems: 'center', height: 18 }}>
      {[10, 16, 8, 14, 18, 9, 15, 11, 17, 8, 13].map((h, i) => (
        <span
          key={i}
          style={{
            width: 3,
            height: h,
            borderRadius: 2,
            background: 'var(--leaf)',
            animation: active ? `lc-listen 0.9s ease-in-out ${i * 0.08}s infinite` : 'none',
            opacity: active ? 1 : 0.4,
          }}
        />
      ))}
    </span>
  );
}

/** Page text with focus words colored: first = sky blue, rest = leaf green. */
function PageText({ text, focusWords }: { text: string; focusWords: string[] }) {
  const lower = focusWords.map((w) => w.toLowerCase());
  return (
    <p className="lc-page-text">
      {text.split(/(\s+)/).map((tok, i) => {
        const clean = tok.toLowerCase().replace(/[^a-z']/g, '');
        const idx = clean ? lower.indexOf(clean) : -1;
        const color = idx === 0 ? 'var(--sky)' : idx > 0 ? 'var(--leaf)' : undefined;
        return (
          <span key={i} style={color ? { color, fontWeight: 700 } : undefined}>
            {tok}
          </span>
        );
      })}
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
    setChapter(chapterFor(p.interests[0]));
    return () => {
      disposedRef.current = true;
      sessionRef.current?.cancel();
      sessionRef.current = null;
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
    };
  }, [router]);

  if (!profile || !chapter) return <div className="screen" />;
  const page = chapter.pages[pageIdx];
  const scene = SCENES[profile.interests[0]] ?? SCENES.dogs;

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
    try {
      const authToken = user ? await user.getIdToken() : null;
      const session = await startReadingSession({
        referenceText,
        authToken,
        onStatus: (s) => {
          if (disposedRef.current) return;
          if (s === 'listening') setPhase('listening');
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

  function celebrateAndAdvance() {
    setPhase('celebrate');
    setTimeout(() => {
      if (!disposedRef.current) advance();
    }, 1300);
  }

  function advance() {
    setTricky(null);
    attemptRef.current = 0;
    if (pageIdx + 1 < chapter!.pages.length) {
      setPageIdx((i) => i + 1);
      setPhase('ready');
    } else {
      finishChapter();
    }
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
      <div className="scene" style={{ background: scene }}>
      <div className="screen">
        <header style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 18px' }}>
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
          <div aria-hidden style={{ fontSize: 64, marginBottom: 40, animation: 'lc-float 4s ease-in-out infinite' }}>
            🌈🐕
          </div>
          <p
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
          <p
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
    <div className="scene" style={{ background: scene }}>
    <div className="screen">
      <header style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 18px' }}>
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
            router.push('/home');
          }}
        >
          ✕
        </button>
        <button className="icon-btn" aria-label="Read aloud">
          🔊
        </button>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '4px 22px 26px' }}>
        <div
          style={{
            background: 'rgba(255,255,255,0.96)',
            borderRadius: 18,
            padding: '26px 24px 18px',
            boxShadow: '0 6px 20px rgba(43,43,43,0.16)',
            animation: 'lc-pop 0.25s ease',
          }}
        >
          {/* Keep the big word visible through the retry's listening/scoring —
              hiding it the moment the child taps "Try the word" defeats it. */}
          {tricky ? (
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 15, color: 'var(--ink-soft)', margin: '0 0 14px' }}>
                Let&rsquo;s try that word together.
              </p>
              <p className="lc-tricky-word">{tricky}</p>
              <div aria-hidden style={{ color: 'var(--sky)', letterSpacing: 4, fontSize: 20, marginBottom: 8 }}>
                • • •
              </div>
            </div>
          ) : (
            <PageText text={page.text} focusWords={page.focusWords} />
          )}
          <div aria-hidden style={{ textAlign: 'center', marginTop: 14, letterSpacing: 4, fontSize: 11 }}>
            {chapter.pages.map((_, i) => (
              <span key={i} style={{ color: i === pageIdx ? 'var(--leaf)' : 'var(--stone-deep)' }}>
                ●
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
          <div style={{ textAlign: 'center', fontSize: 44, animation: 'lc-pop 0.3s ease' }} aria-label="Great reading!">
            🎉⭐
          </div>
        ) : phase === 'correction' && tricky ? (
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn-primary"
              style={{ background: 'var(--sky)', boxShadow: '0 3px 0 #5f9ccb', flex: 1 }}
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
              onClick={celebrateAndAdvance}
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
              background: 'rgba(255,255,255,0.96)',
              border: 0,
              borderRadius: 16,
              padding: '16px 18px',
              fontSize: 15,
              color: 'var(--ink-soft)',
              boxShadow: '0 4px 14px rgba(43,43,43,0.14)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              width: '100%',
            }}
          >
            <Waveform active={phase === 'listening'} />
            {phase === 'ready' && 'Tap, then read the page out loud!'}
            {phase === 'listening' && 'I’m listening...'}
            {phase === 'scoring' && 'One moment...'}
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
