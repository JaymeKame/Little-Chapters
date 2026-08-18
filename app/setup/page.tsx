'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { INTERESTS, saveProfile, type InterestId } from '@/lib/profile';

const INTEREST_ART: Record<InterestId, string> = {
  dogs: '/images/setup/interest-dogs.png',
  space: '/images/setup/interest-space.png',
  dinosaurs: '/images/setup/interest-dinosaurs.png',
  trains: '/images/setup/interest-trains.png',
  unicorns: '/images/setup/interest-unicorns.png',
  ocean: '/images/setup/interest-ocean.png',
};

export default function SetupPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [age, setAge] = useState(6);
  const [picked, setPicked] = useState<InterestId[]>([]);

  const ready = name.trim().length > 0 && picked.length === 3;

  function toggle(id: InterestId) {
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 3 ? [...prev, id] : prev,
    );
  }

  function start() {
    if (!ready) return;
    saveProfile({ childName: name.trim(), age, interests: picked, createdAt: Date.now() });
    router.push('/home');
  }

  return (
    <div className="screen lc-setup">
      <header className="lc-setup-header">
        <button onClick={() => router.push('/')} aria-label="Back" className="lc-setup-back">
          ‹
        </button>
        <div aria-hidden className="lc-setup-progress">
          <span className="is-current" />
          <i className="is-complete" />
          <span />
          <i />
          <span />
        </div>
        <span />
      </header>

      <main className="lc-setup-main">
        <div className="lc-setup-intro">
          <h1>Let&rsquo;s create their story.</h1>
          <p>
            This helps us write chapters
            <br />
            just for them.
          </p>
          <div className="lc-setup-avatar-wrap">
            <img src="/images/setup/avatar-boy.png" alt="" aria-hidden className="lc-setup-avatar" />
          </div>
        </div>

        <div className="lc-setup-fields">
          <label className="lc-setup-label">What&rsquo;s their first name?</label>
          <div className="lc-name-field">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="James"
              aria-label="Child's first name"
            />
            {name.trim() && <span className="lc-name-check">✓</span>}
          </div>

          <label className="lc-setup-label">How old are they?</label>
          <div className="lc-age-stepper">
            <button onClick={() => setAge((a) => Math.max(3, a - 1))} aria-label="Younger">
              −
            </button>
            <span>{age}</span>
            <button onClick={() => setAge((a) => Math.min(12, a + 1))} aria-label="Older">
              +
            </button>
          </div>

          <label className="lc-setup-label lc-interest-label">
            What do they love? <span>Pick 3</span>
          </label>
          <div className="lc-interest-grid">
            {INTERESTS.map((it) => {
              const on = picked.includes(it.id);
              return (
                <button
                  key={it.id}
                  onClick={() => toggle(it.id)}
                  aria-pressed={on}
                  className={`lc-interest${on ? ' is-selected' : ''}`}
                >
                  {on && <span className="lc-interest-check">✓</span>}
                  <img src={INTEREST_ART[it.id]} alt="" aria-hidden className="lc-interest-thumb" />
                  <span>{it.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </main>

      <footer className="lc-setup-footer">
        <button className="btn-primary" onClick={start} disabled={!ready}>
          Start Their First Chapter ✨
        </button>
        {!ready && (
          <p role="status" className="lc-setup-status">
            {!name.trim()
              ? 'First, add their name above ✏️'
              : `Pick ${3 - picked.length} more thing${3 - picked.length === 1 ? '' : 's'} they love`}
          </p>
        )}
      </footer>
    </div>
  );
}
