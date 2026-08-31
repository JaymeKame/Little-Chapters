'use client';

/* Screen 6 — Parent message (after each session). Mockup: a chat-style
 * message from Little Chapters — warm, specific, pressure-free. No scores.
 * No comparison. Just what they practiced, new words, and tomorrow's hook.  */

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PetCompanion, usePet } from '@/components/PetCompanion';
import { useAuth } from '@/components/AuthProvider';
import { loadProfile, loadReport, type ChildProfile, type SessionReport } from '@/lib/profile';
import { loadChapterHistory, type ChapterHistoryEntry } from '@/lib/chapter-history';
import { ParentMessages } from '@/components/ParentMessages';
import { PaymentAttentionBanner } from '@/components/PaymentAttentionBanner';

const PRACTICE_ICONS = ['🌱', '✨', '🪄'];

export default function ParentMessagePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const pet = usePet(authLoading ? undefined : (user?.uid ?? null));
  const [profile, setProfile] = useState<ChildProfile | null>(null);
  const [report, setReport] = useState<SessionReport | null>(null);
  const [now, setNow] = useState('');
  const [history, setHistory] = useState<ChapterHistoryEntry[]>([]);

  useEffect(() => {
    setProfile(loadProfile());
    setReport(loadReport());
    setNow(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  }, []);

  useEffect(() => {
    // Waits for auth to resolve so a signed-in parent's cross-device history
    // isn't rendered from the anonymous slot for one frame. History is the
    // one thing here that works the same whether or not the parent ever
    // registered — unlike <ParentMessages/>, which only exists post sign-up.
    if (authLoading) return;
    let cancelled = false;
    void loadChapterHistory(user?.uid ?? null).then((h) => {
      if (!cancelled) setHistory(h);
    });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  const name = report?.childName ?? profile?.childName ?? 'your reader';
  const isToday = report?.date === new Date().toLocaleDateString('en-CA');
  const reportDay =
    report && !isToday
      ? new Date(`${report.date}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
      : null;

  return (
    <div className="screen" style={{ background: '#f4f2ee' }}>
      <PaymentAttentionBanner />
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 16px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--paper)',
        }}
      >
        <button
          onClick={() => router.push('/home')}
          aria-label="Back"
          // 44px hit area — see the matching note on the setup screen.
          style={{
            border: 0,
            background: 'none',
            fontSize: 20,
            color: 'var(--ink-soft)',
            width: 44,
            height: 44,
            padding: 0,
            marginLeft: -10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ‹
        </button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div aria-hidden style={{ fontSize: 22 }}>
            📖
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>Little Chapters</div>
        </div>
        <span style={{ width: 28 }} />
      </header>

      <main style={{ flex: 1, padding: '18px 18px 30px' }}>
        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--ink-soft)', margin: '0 0 14px' }}>
          {reportDay ?? `Today ${now}`}
        </p>

        {/* In-app message display */}
        <ParentMessages />

        {/* Legacy session report display */}
        {report ? (
          <div
            style={{
              background: '#f2f2f2',
              borderRadius: 17,
              padding: '15px 16px',
              fontSize: 13.5,
              lineHeight: 1.6,
              maxWidth: 330,
            }}
          >
            <p style={{ margin: '0 0 12px' }}>Hi there! 👋</p>
            <p style={{ margin: '0 0 12px' }}>
              {name} read a great chapter {isToday ? 'today' : `on ${reportDay}`}.
            </p>
            <p style={{ margin: '0 0 4px' }}>They practiced:</p>
            <div style={{ margin: '0 0 12px' }}>
              {report.practiced.slice(0, 3).map((p, i) => (
                <div key={`${p.word}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span aria-hidden style={{ fontSize: 12 }}>
                    {PRACTICE_ICONS[i % PRACTICE_ICONS.length]}
                  </span>
                  <span>{p.hint}</span>
                </div>
              ))}
            </div>
            <p style={{ margin: '0 0 4px' }}>New words they read:</p>
            <p style={{ margin: '0 0 12px', color: 'var(--leaf)', fontWeight: 600 }}>
              {report.newWords.slice(0, 6).join(', ')}
            </p>
            <p style={{ margin: '0 0 12px', color: 'var(--ink-soft)' }}>—</p>
            <p style={{ margin: '0 0 12px' }}>
              {isToday ? 'Tomorrow' : 'Next chapter'}: {report.teaser}
            </p>
            <p style={{ margin: 0 }}>{isToday ? 'See you tomorrow!' : 'See you soon!'}</p>
            <p aria-hidden style={{ margin: '10px 0 0', fontSize: 16 }}>
              💚
            </p>
          </div>
        ) : (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--line)',
              borderRadius: '16px 16px 16px 4px',
              padding: '16px 18px',
              fontSize: 14.5,
              lineHeight: 1.65,
              maxWidth: 330,
            }}
          >
            <p style={{ margin: '0 0 10px' }}>Hi there! 👋</p>
            <p style={{ margin: 0 }}>
              After {name ? `${name}'s` : 'the'} first chapter tonight, you&rsquo;ll get a note here about what they
              practiced and the new words they read. No scores. No pressure. 💚
            </p>
          </div>
        )}
        {/* Earlier chapters — same no-scores rule as the note above: dates and
            words only, nothing that reads as a metric. Excludes whichever
            chapter is already shown as "today"/the latest report above, so
            nothing appears twice. Works for every child, registered or not —
            unlike <ParentMessages/>, which only exists post sign-up. */}
        {(() => {
          const earlier = history.filter((h) => h.chapterId !== report?.chapterId).slice(0, 6);
          if (earlier.length === 0) return null;
          return (
            <div style={{ marginTop: 18, maxWidth: 330 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', margin: '0 0 8px' }}>Earlier chapters</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {earlier.map((h) => (
                  <div
                    key={h.chapterId}
                    style={{
                      background: 'var(--card)',
                      border: '1px solid var(--line)',
                      borderRadius: 10,
                      padding: '8px 12px',
                      fontSize: 12.5,
                    }}
                  >
                    <span style={{ color: 'var(--ink-soft)' }}>
                      {new Date(`${h.date}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                    {h.newWords.length > 0 && <span> — {h.newWords.slice(0, 4).join(', ')}</span>}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
        {/* Progress detail lives HERE, not on the child's screens — the
            handoff forbids scores/streaks/XP in child-facing UI. */}
        <div style={{ marginTop: 22 }}>
          <PetCompanion pet={pet} variant="parent" />
        </div>
      </main>
    </div>
  );
}
