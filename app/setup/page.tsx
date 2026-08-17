'use client';

/* Screen 2 — Parent setup (takes < 30 seconds). Mockup: progress dots,
 * "Let's create their story.", name input with green check, age stepper,
 * "Pick 3" interest grid with check badges, gold CTA with sparkle.
 * "Feels like the beginning of a story, not a signup" — no account fields.  */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { INTERESTS, saveProfile, type InterestId } from '@/lib/profile';

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
    <div className="screen">
      <header style={{ display: 'flex', alignItems: 'center', padding: '18px 22px 4px' }}>
        <button
          onClick={() => router.push('/')}
          aria-label="Back"
          style={{ border: 0, background: 'none', fontSize: 20, color: 'var(--ink-soft)', padding: 4 }}
        >
          ‹
        </button>
        {/* Progress: step 1 of 3 — green, per the handoff (● ─ ○ ─ ○) */}
        <div aria-hidden style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0 }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--leaf)' }} />
          <span style={{ width: 54, height: 2, background: 'var(--leaf)' }} />
          <span style={{ width: 10, height: 10, borderRadius: 999, border: '2px solid var(--leaf)', background: 'var(--paper)' }} />
          <span style={{ width: 54, height: 2, background: 'var(--stone-deep)' }} />
          <span style={{ width: 10, height: 10, borderRadius: 999, border: '2px solid var(--stone-deep)', background: 'var(--paper)' }} />
        </div>
        <span style={{ width: 28 }} />
      </header>

      <main style={{ flex: 1, padding: '18px 30px 0', textAlign: 'center' }}>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: 28, margin: '6px 0 8px' }}>Let&rsquo;s create their story.</h1>
        <p style={{ color: 'var(--ink-soft)', fontSize: 14, margin: '0 0 20px' }}>
          This helps us write chapters
          <br />
          just for them.
        </p>

        <div
          aria-hidden
          style={{
            width: 100,
            height: 100,
            margin: '0 auto 24px',
            borderRadius: 999,
            background: 'linear-gradient(180deg, #fdf3dd, #f6e7c8)',
            border: '2px solid var(--stone-deep)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 46,
          }}
        >
          🧒
        </div>

        <label style={{ display: 'block', textAlign: 'left', fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>
          What&rsquo;s their first name?
        </label>
        <div style={{ position: 'relative', marginBottom: 20 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="James"
            aria-label="Child's first name"
            style={{
              width: '100%',
              padding: '13px 40px 13px 14px',
              fontSize: 16,
              borderRadius: 12,
              border: `1.5px solid ${name.trim() ? 'var(--leaf)' : 'var(--line)'}`,
              background: 'var(--card)',
              outline: 'none',
            }}
          />
          {name.trim() && (
            <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--leaf)', fontWeight: 700 }}>
              ✓
            </span>
          )}
        </div>

        <label style={{ display: 'block', textAlign: 'left', fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>
          How old are they?
        </label>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            border: '1.5px solid var(--line)',
            borderRadius: 12,
            background: 'var(--card)',
            marginBottom: 20,
          }}
        >
          <button
            onClick={() => setAge((a) => Math.max(3, a - 1))}
            aria-label="Younger"
            style={{ border: 0, background: 'none', fontSize: 22, padding: '10px 20px', color: 'var(--ink-soft)' }}
          >
            −
          </button>
          <span style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: 600 }}>{age}</span>
          <button
            onClick={() => setAge((a) => Math.min(12, a + 1))}
            aria-label="Older"
            style={{ border: 0, background: 'none', fontSize: 22, padding: '10px 20px', color: 'var(--ink-soft)' }}
          >
            +
          </button>
        </div>

        <label style={{ display: 'block', textAlign: 'left', fontSize: 13.5, fontWeight: 600, marginBottom: 10 }}>
          What do they love? <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>Pick 3</span>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 26 }}>
          {INTERESTS.map((it) => {
            const on = picked.includes(it.id);
            return (
              <button
                key={it.id}
                onClick={() => toggle(it.id)}
                aria-pressed={on}
                style={{
                  position: 'relative',
                  border: `1.5px solid ${on ? 'var(--leaf)' : 'var(--line)'}`,
                  background: on ? '#f2f9f5' : 'var(--card)',
                  borderRadius: 14,
                  padding: '14px 6px 10px',
                  fontSize: 12.5,
                  color: 'var(--ink)',
                }}
              >
                {on && (
                  <span
                    style={{
                      position: 'absolute',
                      top: -7,
                      right: -7,
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      background: 'var(--leaf)',
                      color: '#fff',
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    ✓
                  </span>
                )}
                <div style={{ fontSize: 28, marginBottom: 6 }}>{it.emoji}</div>
                {it.label}
              </button>
            );
          })}
        </div>
      </main>

      <footer style={{ padding: '0 30px 26px' }}>
        <button className="btn-primary" onClick={start} disabled={!ready}>
          Start Their First Chapter ✨
        </button>
        {/* A disabled button that silently ignores clicks reads as "broken" —
            always say exactly what's still needed. */}
        {!ready && (
          <p role="status" style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--ink-soft)', margin: '10px 0 0' }}>
            {!name.trim()
              ? 'First, add their name above ✏️'
              : `Pick ${3 - picked.length} more thing${3 - picked.length === 1 ? '' : 's'} they love`}
          </p>
        )}
      </footer>
    </div>
  );
}
