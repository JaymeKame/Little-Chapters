'use client';

/* Screen 6 — Parent message (after each session). Mockup: a chat-style
 * message from Little Chapters — warm, specific, pressure-free. No scores.
 * No comparison. Just what they practiced, new words, and tomorrow's hook.  */

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { loadProfile, loadReport, type ChildProfile, type SessionReport } from '@/lib/profile';

export default function ParentMessagePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ChildProfile | null>(null);
  const [report, setReport] = useState<SessionReport | null>(null);
  const [now, setNow] = useState('');

  useEffect(() => {
    setProfile(loadProfile());
    setReport(loadReport());
    setNow(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  }, []);

  const name = report?.childName ?? profile?.childName ?? 'your reader';

  return (
    <div className="screen" style={{ background: '#f4f2ee' }}>
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
          style={{ border: 0, background: 'none', fontSize: 20, color: 'var(--ink-soft)', padding: 4 }}
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
          Today {now}
        </p>

        {report ? (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--line)',
              borderRadius: '16px 16px 16px 4px',
              padding: '16px 18px',
              fontSize: 14.5,
              lineHeight: 1.65,
              maxWidth: 330,
              boxShadow: '0 1px 4px rgba(43,43,43,0.06)',
            }}
          >
            <p style={{ margin: '0 0 12px' }}>Hi there! 👋</p>
            <p style={{ margin: '0 0 12px' }}>
              {name} read a great chapter today.
            </p>
            <p style={{ margin: '0 0 4px' }}>He practiced:</p>
            <div style={{ margin: '0 0 12px' }}>
              {report.practiced.slice(0, 3).map((p) => (
                <div key={p.hint} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span aria-hidden style={{ fontSize: 12 }}>
                    ✳️
                  </span>
                  <span>{p.hint}</span>
                </div>
              ))}
            </div>
            <p style={{ margin: '0 0 4px' }}>New words he read:</p>
            <p style={{ margin: '0 0 12px', color: 'var(--leaf)', fontWeight: 600 }}>
              {report.newWords.slice(0, 6).join(', ')}
            </p>
            <p style={{ margin: '0 0 12px', color: 'var(--ink-soft)' }}>—</p>
            <p style={{ margin: '0 0 12px' }}>
              Tomorrow: {report.teaser}
            </p>
            <p style={{ margin: 0 }}>See you tomorrow!</p>
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
      </main>
    </div>
  );
}
