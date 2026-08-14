'use client';

/* Screen 1 — Landing page (for the parent). Mockup: serif headline, green
 * serif subhead, three feature chips, warm illustration, single green CTA.
 * "Permission, not guilt." — calm, no urgency patterns.                     */

import Link from 'next/link';

const FEATURES = [
  { emoji: '🕰️', label: 'Made for real life' },
  { emoji: '📖', label: 'Built around phonics' },
  { emoji: '📅', label: 'One new chapter a day' },
];

export default function LandingPage() {
  return (
    <div className="screen">
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '18px 22px 6px',
        }}
      >
        <span style={{ fontFamily: 'var(--serif)', fontWeight: 700, fontSize: 17 }}>
          Little Chapters<span style={{ fontSize: 10, verticalAlign: 'super' }}>™</span>
        </span>
        <span aria-hidden style={{ fontSize: 20, color: 'var(--ink-soft)' }}>
          ☰
        </span>
      </header>

      <main style={{ flex: 1, padding: '26px 26px 0', textAlign: 'center' }}>
        <h1
          style={{
            fontFamily: 'var(--serif)',
            fontSize: 40,
            lineHeight: 1.12,
            margin: '10px 0 14px',
            letterSpacing: '-0.01em',
          }}
        >
          The better
          <br />
          20 minutes.
        </h1>
        <p
          style={{
            fontFamily: 'var(--serif)',
            fontStyle: 'italic',
            color: 'var(--leaf)',
            fontSize: 19,
            lineHeight: 1.35,
            margin: '0 0 14px',
          }}
        >
          A story they love.
          <br />
          Progress you can feel good about.
        </p>
        <p style={{ color: 'var(--ink-soft)', fontSize: 14.5, lineHeight: 1.55, maxWidth: 300, margin: '0 auto 22px' }}>
          AI writes a new chapter every day at exactly their level. They read. AI listens. The adventure continues
          tomorrow.
        </p>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 22 }}>
          {FEATURES.map((f) => (
            <div
              key={f.label}
              style={{
                background: 'var(--card)',
                border: '1px solid var(--line)',
                borderRadius: 12,
                padding: '10px 8px',
                width: 96,
                fontSize: 11.5,
                lineHeight: 1.3,
                color: 'var(--ink-soft)',
              }}
            >
              <div style={{ fontSize: 20, marginBottom: 4 }}>{f.emoji}</div>
              {f.label}
            </div>
          ))}
        </div>

        {/* Illustration stand-in: cozy reading moment (mockup: child + dog on the couch). */}
        <div
          aria-hidden
          style={{
            background: 'linear-gradient(180deg, #fdf6e6 0%, #f3e8d2 100%)',
            border: '1px solid var(--line)',
            borderRadius: 18,
            padding: '26px 10px 18px',
            fontSize: 56,
            letterSpacing: 8,
            marginBottom: 24,
          }}
        >
          <span style={{ display: 'inline-block', animation: 'lc-float 4s ease-in-out infinite' }}>🪴</span>
          <span>🧒📖</span>
          <span>🐕</span>
        </div>
      </main>

      <footer style={{ padding: '0 26px 22px', textAlign: 'center' }}>
        <Link href="/setup" style={{ textDecoration: 'none' }}>
          <span className="btn-primary" style={{ display: 'block' }}>
            Try a Chapter Free Tonight
          </span>
        </Link>
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '12px 0 6px' }}>
          $20/month after your first chapter.
        </p>
        <p style={{ fontSize: 13, margin: '0 0 18px' }}>
          <span style={{ color: 'var(--sunshine)', letterSpacing: 2 }}>★★★★★</span>{' '}
          <span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>Loved by parents</span>
        </p>
        <p style={{ fontSize: 10.5, color: 'var(--ink-soft)', borderTop: '1px solid var(--line)', paddingTop: 12, margin: 0 }}>
          littlechapters.com&nbsp;&nbsp;|&nbsp;&nbsp;Little Chapters™&nbsp;&nbsp;|&nbsp;&nbsp;All rights reserved
        </p>
      </footer>
    </div>
  );
}
