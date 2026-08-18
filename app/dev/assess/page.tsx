'use client';

/* Pipeline test harness for the kids' reading assessment — NOT the final UI.
 * Exercises the whole loop: mic capture → Azure pronunciation assessment →
 * aggregated scores + per-word errors + playback of the recording.          */

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import {
  startReadingSession,
  type ReadingAssessmentResult,
  type ReadingSession,
  type ReadingSessionStatus,
  type WordScore,
} from '@/lib/pronunciation';
import { combineVerdicts, type DecodeResult, type WordVerdict } from '@/lib/reading-verdict';
import { PetCompanion, usePet } from '@/components/PetCompanion';

const DEFAULT_TEXT = 'The little cat sat on the mat and looked at the big red sun.';

const ERROR_STYLES: Record<string, { background: string; color: string; label: string }> = {
  None: { background: '#e6f4ea', color: '#137333', label: 'good' },
  Mispronunciation: { background: '#fef7e0', color: '#b06000', label: 'mispronounced' },
  Omission: { background: '#fce8e6', color: '#c5221f', label: 'skipped' },
  Insertion: { background: '#e8eaed', color: '#5f6368', label: 'extra word' },
};

function WordChip({ w, verdict }: { w: WordScore; verdict?: WordVerdict | null }) {
  const style = ERROR_STYLES[w.errorType] ?? ERROR_STYLES.Insertion;
  const title =
    `${w.errorType}${w.accuracy != null ? ` · accuracy ${w.accuracy}` : ''}` +
    (w.phonemes.length ? `\n${w.phonemes.map((p) => `${p.phoneme} ${p.accuracy ?? '–'}`).join('  ')}` : '') +
    (verdict?.decodeScore != null ? `\ndecode ${verdict.decodeScore} (heard: ${verdict.decodeHeard || '–'})` : '') +
    (verdict?.needsHelp ? `\nNEEDS HELP (${verdict.reason})` : '');
  return (
    <span
      title={title}
      style={{
        background: style.background,
        color: style.color,
        padding: '3px 8px',
        borderRadius: 6,
        fontSize: 15,
        textDecoration: w.errorType === 'Omission' ? 'line-through' : 'none',
        fontStyle: w.errorType === 'Insertion' ? 'italic' : 'normal',
        cursor: 'default',
        boxShadow: verdict?.needsHelp ? '0 0 0 2px #c5221f' : 'none',
      }}
    >
      {w.word}
    </span>
  );
}

function ScoreTile({ label, value }: { label: string; value: number | null }) {
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: '10px 14px', minWidth: 110 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#666' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600 }}>{value != null ? value : '–'}</div>
    </div>
  );
}

export default function ReadingPage() {
  const { user, loading: authLoading } = useAuth();
  const pet = usePet(authLoading ? undefined : (user?.uid ?? null));
  const [referenceText, setReferenceText] = useState(DEFAULT_TEXT);
  const [status, setStatus] = useState<ReadingSessionStatus | 'idle'>('idle');
  const [partial, setPartial] = useState('');
  const [liveWords, setLiveWords] = useState<WordScore[]>([]);
  const [result, setResult] = useState<ReadingAssessmentResult | null>(null);
  const [verdicts, setVerdicts] = useState<WordVerdict[] | null>(null);
  const [decodeState, setDecodeState] = useState<'idle' | 'checking' | 'done' | 'offline'>('idle');
  const [decodeNote, setDecodeNote] = useState<string | null>(null);
  const takeRef = useRef(0); // increments per session so stale decodes can't land on a newer take
  const pendingAwardRef = useRef<ReadingAssessmentResult | null>(null); // scored take whose XP hasn't been granted yet
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const sessionRef = useRef<ReadingSession | null>(null);
  const startingRef = useRef(false); // synchronous double-Start guard
  const stopRequestedRef = useRef(false); // Stop clicked while still connecting
  const disposedRef = useRef(false);

  // Release the mic if the page unmounts mid-session — including a session
  // that finishes starting after unmount (start() checks disposedRef).
  useEffect(() => {
    disposedRef.current = false; // re-arm for StrictMode dev remount
    return () => {
      disposedRef.current = true;
      sessionRef.current?.cancel();
      sessionRef.current = null;
    };
  }, []);
  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  const recording = status === 'connecting' || status === 'listening';

  /* A completed reading earned its XP even if the decode check never
   * finished — grant it via the Azure-only rule before abandoning the take. */
  function flushPendingAward() {
    const r = pendingAwardRef.current;
    if (!r) return;
    pendingAwardRef.current = null;
    if (r.words.length > 0) {
      const vs = combineVerdicts(r.words, null);
      pet.awardReading({
        accuracy: r.scores.accuracy,
        wordCount: r.words.filter((w) => w.errorType !== 'Insertion').length,
        flaggedCount: vs.filter((v) => v.needsHelp).length,
      });
    }
  }

  async function start() {
    if (startingRef.current || sessionRef.current) return;
    startingRef.current = true;
    stopRequestedRef.current = false;
    flushPendingAward();
    takeRef.current += 1;
    setError(null);
    setResult(null);
    setVerdicts(null);
    setDecodeState('idle');
    setDecodeNote(null);
    setPartial('');
    setLiveWords([]);
    setAudioUrl(null);
    try {
      // Don't mint a session before auth resolves — the request would go out
      // unauthenticated and 401 in any environment with admin credentials.
      if (authLoading) return;
      const authToken = user ? await user.getIdToken() : null;
      const session = await startReadingSession({
        referenceText,
        authToken,
        onStatus: (s) => {
          if (disposedRef.current || stopRequestedRef.current) return;
          setStatus(s);
          // Mid-session fatal error (e.g. connection drop): the session is
          // dead — collect whatever was assessed instead of listening forever.
          if (s === 'error' && sessionRef.current) void stop();
        },
        onPartialTranscript: (t) => {
          if (!disposedRef.current) setPartial(t);
        },
        onSegment: (words) => {
          if (!disposedRef.current) setLiveWords((prev) => [...prev, ...words]);
        },
      });
      if (disposedRef.current || stopRequestedRef.current) {
        session.cancel(); // resolved after unmount/abort: release the mic
        if (!disposedRef.current) setStatus('idle');
        return;
      }
      sessionRef.current = session;
    } catch (e) {
      if (!disposedRef.current) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      startingRef.current = false;
    }
  }

  async function stop() {
    const session = sessionRef.current;
    if (!session) {
      if (startingRef.current) {
        // Still connecting: flag the in-flight start to cancel itself.
        stopRequestedRef.current = true;
        setStatus('idle');
      }
      return;
    }
    sessionRef.current = null;
    try {
      const r = await session.stop();
      if (disposedRef.current) return; // unmounted: never mint the object URL
      setResult(r);
      if (r.audio) setAudioUrl(URL.createObjectURL(r.audio));
      void runDecode(r);
    } catch (e) {
      if (disposedRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setStatus('idle');
    }
  }

  /* Hybrid decoding verdicts: send the raw WAV to the MDD service via our
   * proxy route; on any failure fall back to Azure-only verdicts. Verdicts
   * landing is also the single point where the pet earns XP for the take. */
  async function runDecode(r: ReadingAssessmentResult) {
    const take = takeRef.current;
    const live = () => !disposedRef.current && takeRef.current === take;
    const finish = (vs: WordVerdict[], state: 'done' | 'offline') => {
      pendingAwardRef.current = null;
      setVerdicts(vs);
      setDecodeState(state);
      if (r.words.length > 0) {
        pet.awardReading({
          accuracy: r.scores.accuracy,
          wordCount: r.words.filter((w) => w.errorType !== 'Insertion').length,
          flaggedCount: vs.filter((v) => v.needsHelp).length,
        });
      }
    };
    if (!r.audioWav || r.words.length === 0) {
      finish(combineVerdicts(r.words, null), r.audioWav ? 'done' : 'offline');
      return;
    }
    pendingAwardRef.current = r;
    setDecodeState('checking');
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
      if (!live()) return;
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; word?: string; hint?: string };
        if (!live()) return;
        setDecodeNote(
          body.error === 'UNKNOWN_WORD'
            ? `Decoding skipped — "${body.word}" isn't in the dictionary yet (add it to mdd/grader.py MANUAL_PRONS).`
            : body.hint || body.error || null,
        );
        throw new Error(String(res.status));
      }
      const decode = (await res.json()) as DecodeResult;
      if (!live()) return;
      finish(combineVerdicts(r.words, decode), 'done');
    } catch {
      if (!live()) return;
      finish(combineVerdicts(r.words, null), 'offline');
    }
  }

  /* Dev-only: fabricate a scored take so the pet/verdict flow can be tested
   * without a microphone. Goes through the same combineVerdicts + award path
   * as a real reading. */
  function simulateReading(kind: 'good' | 'tricky') {
    flushPendingAward();
    takeRef.current += 1;
    const tokens = referenceText.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return;
    const words: WordScore[] = tokens.map((t, i) => {
      const weak = kind === 'tricky' && i % 3 === 0;
      return {
        word: t.toLowerCase().replace(/[^a-z']/gi, ''),
        accuracy: weak ? 55 : 96,
        errorType: 'None',
        offsetMs: i * 400,
        durationMs: 300,
        phonemes: [{ phoneme: 'ə', accuracy: weak ? 30 : 95 }],
      };
    });
    const accuracy = kind === 'good' ? 95 : 68;
    const r: ReadingAssessmentResult = {
      scores: { pronunciation: accuracy, accuracy, fluency: 92, completeness: 100, prosody: 84 },
      words,
      transcript: tokens.join(' '),
      referenceText,
      audio: null,
      audioWav: null,
      durationMs: 5000,
      warning: null,
      raw: [],
    };
    setError(null);
    setResult(r);
    setAudioUrl(null);
    setDecodeNote(null);
    // audioWav is null, so verdicts come from the Azure-only fallback rule —
    // the weak words' 30-phoneme scores land under the <40 threshold.
    const vs = combineVerdicts(words, null);
    setVerdicts(vs);
    setDecodeState('done');
    pet.awardReading({
      accuracy,
      wordCount: words.length,
      flaggedCount: vs.filter((v) => v.needsHelp).length,
    });
  }

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 20px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Reading assessment — pipeline test</h1>
      <p style={{ color: '#666', fontSize: 14, marginBottom: 20 }}>
        Mic → Azure pronunciation assessment. Temporary harness UI; the kid-facing UI comes later.
        {!user && ' Not signed in — works locally, but production requires sign-in.'}
      </p>

      <PetCompanion pet={pet} />

      <label style={{ display: 'block', fontSize: 13, color: '#444', marginBottom: 6 }}>
        Text the child should read
      </label>
      <textarea
        value={referenceText}
        onChange={(e) => setReferenceText(e.target.value)}
        rows={3}
        disabled={recording}
        style={{ width: '100%', fontSize: 16, padding: 10, borderRadius: 8, border: '1px solid #ccc', marginBottom: 14 }}
      />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20 }}>
        {!recording ? (
          <button
            onClick={start}
            disabled={!referenceText.trim() || status === 'stopping'}
            style={{ background: '#1a73e8', color: '#fff', border: 0, borderRadius: 8, padding: '10px 22px', fontSize: 16, cursor: 'pointer' }}
          >
            🎙️ Start reading
          </button>
        ) : (
          <button
            onClick={stop}
            style={{ background: '#c5221f', color: '#fff', border: 0, borderRadius: 8, padding: '10px 22px', fontSize: 16, cursor: 'pointer' }}
          >
            ⏹ Stop &amp; score
          </button>
        )}
        <span style={{ fontSize: 13, color: '#666' }}>
          {status === 'connecting' && 'Connecting…'}
          {status === 'listening' && 'Listening — read the text out loud'}
          {status === 'stopping' && 'Scoring…'}
        </span>
        {process.env.NODE_ENV === 'development' && !recording && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button
              onClick={() => simulateReading('good')}
              style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid #ccc', background: '#fff', color: '#666', cursor: 'pointer' }}
            >
              sim: good
            </button>
            <button
              onClick={() => simulateReading('tricky')}
              style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid #ccc', background: '#fff', color: '#666', cursor: 'pointer' }}
            >
              sim: tricky
            </button>
          </span>
        )}
      </div>

      {error && (
        <div style={{ background: '#fce8e6', color: '#c5221f', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      )}

      {recording && (partial || liveWords.length > 0) && (
        <div style={{ border: '1px dashed #ccc', borderRadius: 8, padding: 12, marginBottom: 16 }}>
          {liveWords.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: partial ? 8 : 0 }}>
              {liveWords.map((w, i) => (
                <WordChip key={i} w={w} />
              ))}
            </div>
          )}
          {partial && <div style={{ color: '#888', fontStyle: 'italic', fontSize: 15 }}>{partial}…</div>}
        </div>
      )}

      {result && (
        <section>
          {result.warning && (
            <div style={{ background: '#fef7e0', color: '#b06000', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
              ⚠️ {result.warning}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <ScoreTile label="Overall" value={result.scores.pronunciation} />
            <ScoreTile label="Accuracy" value={result.scores.accuracy} />
            <ScoreTile label="Fluency" value={result.scores.fluency} />
            <ScoreTile label="Completeness" value={result.scores.completeness} />
            <ScoreTile label="Prosody" value={result.scores.prosody} />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {result.words.map((w, i) => (
              <WordChip key={i} w={w} verdict={verdicts?.[i]} />
            ))}
          </div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
            green = good · yellow = mispronounced · red strikethrough = skipped · gray italic = extra word ·
            <strong> red ring = needs help</strong> (both graders flagged it) · hover a word for detail
          </div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
            {decodeState === 'checking' && 'Checking decoding with the phoneme grader…'}
            {decodeState === 'offline' &&
              (decodeNote ?? '⚠ Decoding grader offline — verdicts are Azure-only (start mdd/server.py for the hybrid).')}
            {decodeState === 'done' && verdicts && `Decoding checked — ${verdicts.filter((v) => v.needsHelp).length} word(s) flagged.`}
          </div>

          <div style={{ fontSize: 14, color: '#444', marginBottom: 8 }}>
            Heard: <em>{result.transcript || '(nothing recognized)'}</em>
          </div>

          {audioUrl && <audio controls src={audioUrl} style={{ display: 'block', marginBottom: 16 }} />}

          <details>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: '#666' }}>Raw Azure response</summary>
            <pre style={{ fontSize: 11, overflow: 'auto', background: '#f6f6f6', padding: 12, borderRadius: 8 }}>
              {JSON.stringify(result.raw, null, 2)}
            </pre>
          </details>
        </section>
      )}
    </main>
  );
}
