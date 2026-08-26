'use client';

/* Screen 2 — Parent setup (takes < 30 seconds). Mockup: progress dots,
 * "Let's create their story.", name input with green check, age stepper,
 * "Pick 3" interest grid with check badges, gold CTA with sparkle.
 * "Feels like the beginning of a story, not a signup" — no account fields.  */

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  AVATARS,
  INTERESTS,
  avatarEmoji,
  avatarImageObjectPosition,
  avatarImageSrc,
  interestImageSrc,
  loadProfile,
  newChildId,
  saveProfile,
  type AvatarId,
  type InterestId,
} from '@/lib/profile';

export default function SetupPage() {
  const router = useRouter();
  // Never let this form silently overwrite an existing valid child profile
  // — a returning visitor (anonymous demo or registered) who reaches /setup
  // again (stale bookmark, back button, a shared link) already has a real
  // profile and reading history on this browser; send them to it instead
  // of re-running onboarding over it with a brand-new childId.
  const [checkingExisting, setCheckingExisting] = useState(true);
  const [name, setName] = useState('');
  const [age, setAge] = useState(6);
  const [avatar, setAvatar] = useState<AvatarId | undefined>(undefined);
  const [picked, setPicked] = useState<InterestId[]>([]);
  const [childContext, setChildContext] = useState('');

  useEffect(() => {
    if (loadProfile()) {
      router.replace('/home');
      return;
    }
    setCheckingExisting(false);
  }, [router]);

  const ready = name.trim().length > 0 && picked.length === 3;

  function toggle(id: InterestId) {
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 3 ? [...prev, id] : prev,
    );
  }

  function start() {
    if (!ready) return;
    saveProfile({ childId: newChildId(), childName: name.trim(), age, interests: picked, avatar, childContext: childContext.trim().slice(0, 2000) || undefined, createdAt: Date.now() });
    router.push('/home');
  }

  if (checkingExisting) return <div className="screen" />;

  return (
    <div className="screen">
      <header style={{ display: 'flex', alignItems: 'center', padding: '18px 22px 4px' }}>
        <button
          onClick={() => router.push('/')}
          aria-label="Back"
          // 44px hit area (the glyph alone was 13px wide); negative margin
          // keeps the chevron optically where it was.
          style={{
            border: 0,
            background: 'none',
            fontSize: 20,
            color: 'var(--ink-soft)',
            width: 44,
            height: 44,
            padding: 0,
            marginLeft: -12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
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
            margin: '0 auto 14px',
            borderRadius: 999,
            background: 'linear-gradient(180deg, #fdf3dd, #f6e7c8)',
            border: '2px solid var(--stone-deep)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 46,
            overflow: 'hidden',
          }}
        >
          {avatarImageSrc(avatar) ? (
            <img
              src={avatarImageSrc(avatar)!}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: avatarImageObjectPosition(avatar) }}
            />
          ) : (
            avatarEmoji(avatar)
          )}
        </div>

        <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', margin: '0 0 8px' }}>Pick their look</p>
        <div role="group" aria-label="Choose their picture" style={{ display: 'flex', justifyContent: 'center', gap: 14, marginBottom: 24 }}>
          {AVATARS.map((a) => {
            const on = avatar === a.id;
            return (
              <button
                key={a.id}
                onClick={() => setAvatar(on ? undefined : a.id)}
                aria-pressed={on}
                aria-label={a.label}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 999,
                  border: `2.5px solid ${on ? 'var(--leaf)' : 'transparent'}`,
                  background: 'var(--card)',
                  boxShadow: on ? 'none' : '0 1px 4px rgba(43,43,43,0.12)',
                  overflow: 'hidden',
                  padding: 0,
                  opacity: on ? 1 : 0.75,
                  transition: 'opacity 150ms ease, border-color 150ms ease',
                }}
              >
                <img
                  src={avatarImageSrc(a.id)!}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: avatarImageObjectPosition(a.id) }}
                />
              </button>
            );
          })}
        </div>

        <label style={{ display: 'block', textAlign: 'left', fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>
          What&rsquo;s their first name?
        </label>
        <div style={{ position: 'relative', marginBottom: 20 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Michael"
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '18px 8px', marginBottom: 26 }}>
          {INTERESTS.map((it) => {
            const on = picked.includes(it.id);
            return (
              <button
                key={it.id}
                onClick={() => toggle(it.id)}
                aria-pressed={on}
                style={{
                  border: 0,
                  background: 'transparent',
                  padding: 0,
                  fontSize: 12.5,
                  fontWeight: on ? 600 : 400,
                  color: on ? 'var(--leaf)' : 'var(--ink)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                }}
              >
                {/* The illustration itself is the selectable object — a ring
                    on the circle, not a bounding card, matches the reference. */}
                <span style={{ position: 'relative' }}>
                  <img
                    src={interestImageSrc(it.id)}
                    alt=""
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 999,
                      objectFit: 'cover',
                      border: `3px solid ${on ? 'var(--leaf)' : 'transparent'}`,
                      boxShadow: '0 2px 6px rgba(43,43,43,0.14)',
                      opacity: on ? 1 : 0.85,
                      transition: 'opacity 150ms ease, border-color 150ms ease',
                    }}
                  />
                  {on && (
                    <span
                      style={{
                        position: 'absolute',
                        bottom: -2,
                        right: -2,
                        width: 20,
                        height: 20,
                        borderRadius: 999,
                        background: 'var(--leaf)',
                        color: '#fff',
                        fontSize: 11,
                        border: '2px solid var(--paper)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      ✓
                    </span>
                  )}
                </span>
                <span style={{ marginTop: 7 }}>{it.label}</span>
              </button>
            );
          })}
        </div>
        <label htmlFor="child-context" style={{ display: 'block', textAlign: 'left', fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>
          Tell us anything that helps us know your child <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>(optional)</span>
        </label>
        <textarea
          id="child-context"
          value={childContext}
          maxLength={2000}
          rows={5}
          onChange={(event) => setChildContext(event.target.value)}
          placeholder="Share their interests, favorite things, personality, routines, things that make them laugh, or topics they love."
          style={{ width: '100%', resize: 'vertical', padding: 14, borderRadius: 12, border: '1.5px solid var(--line)', background: 'var(--card)', font: 'inherit', lineHeight: 1.45 }}
        />
        <p style={{ textAlign: 'left', color: 'var(--ink-soft)', fontSize: 12, lineHeight: 1.45, margin: '8px 0 24px' }}>
          We only use this to make their Little Chapters reading experience more relevant to their unique interests and personality. You do not need to share anything sensitive.
        </p>
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
