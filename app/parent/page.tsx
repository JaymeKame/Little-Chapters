'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PetCompanion, usePet } from '@/components/PetCompanion';
import { useAuth } from '@/components/AuthProvider';
import { loadProfile, loadReport, type ChildProfile, type SessionReport } from '@/lib/profile';

const PRACTICE_ICONS = ['🌱', '✨', '🪄'];

export default function ParentMessagePage() {
  const router = useRouter();
  const { user } = useAuth();
  const pet = usePet(user?.uid ?? null);
  const [profile, setProfile] = useState<ChildProfile | null>(null);
  const [report, setReport] = useState<SessionReport | null>(null);
  const [now, setNow] = useState('');

  useEffect(() => {
    setProfile(loadProfile());
    setReport(loadReport());
    setNow(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  }, []);

  const name = report?.childName ?? profile?.childName ?? 'your reader';
  const isToday = report?.date === new Date().toLocaleDateString('en-CA');
  const reportDay =
    report && !isToday
      ? new Date(`${report.date}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
      : null;

  return (
    <div className="screen lc-parent-screen">
      <header className="lc-parent-header">
        <button onClick={() => router.push('/home')} aria-label="Back" className="lc-parent-back">
          ‹
        </button>
        <div className="lc-parent-brand">
          <div aria-hidden className="lc-parent-bookmark">✦</div>
          <div>Little Chapters</div>
        </div>
        <span className="lc-parent-spacer" />
      </header>

      <main className="lc-parent-main">
        <p className="lc-parent-date">{reportDay ?? `Today ${now}`}</p>

        {report ? (
          <div className="lc-parent-message">
            <p className="lc-parent-greeting">Hi there! 👋</p>
            <p>
              {name} read a great chapter {isToday ? 'today' : `on ${reportDay}`}. 
            </p>
            <p className="lc-parent-label">They practiced:</p>
            <div className="lc-parent-list">
              {report.practiced.slice(0, 3).map((p, i) => (
                <div key={`${p.word}-${i}`} className="lc-parent-list-item">
                  <span aria-hidden className="lc-parent-practice-icon">{PRACTICE_ICONS[i % PRACTICE_ICONS.length]}</span>
                  <span>{p.hint}</span>
                </div>
              ))}
            </div>
            <p className="lc-parent-label">New words they read:</p>
            <p className="lc-parent-words">{report.newWords.slice(0, 6).join(', ')}</p>
            <div className="lc-parent-divider" aria-hidden />
            <p>
              {isToday ? 'Tomorrow' : 'Next chapter'}: {report.teaser}
            </p>
            <p className="lc-parent-signoff">{isToday ? 'See you tomorrow!' : 'See you soon!'}</p>
            <p aria-hidden className="lc-parent-heart">💚</p>
          </div>
        ) : (
          <div className="lc-parent-message lc-parent-empty">
            <p className="lc-parent-greeting">Hi there! 👋</p>
            <p>
              After {name ? `${name}'s` : 'the'} first chapter tonight, you&rsquo;ll get a note here about what they practiced and the new words they read. No scores. No pressure. 💚
            </p>
          </div>
        )}

        <div className="lc-parent-pet">
          <PetCompanion pet={pet} variant="parent" />
        </div>
      </main>
    </div>
  );
}
