'use client';

/* Screen 1 — Landing page (for the parent). Mockup: serif headline, green
 * serif subhead, three feature chips, warm illustration, single green CTA.
 * "Permission, not guilt." — calm, no urgency patterns.
 * Responsive: phones read like the mockup frame; ≥900px becomes a proper
 * two-column webpage (parents mostly arrive on laptops).                    */

import Link from 'next/link';

const FEATURES = [
  { emoji: '🕰️', label: 'Made for real life' },
  { emoji: '📖', label: 'Built around phonics' },
  { emoji: '📅', label: 'One new chapter a day' },
];

export default function LandingPage() {
  return (
    <div className="lc-landing">
      <div className="lc-landing-inner">
        <header className="lc-nav">
          <span style={{ fontFamily: 'var(--serif)', fontWeight: 700, fontSize: 18 }}>
            Little Chapters<span style={{ fontSize: 10, verticalAlign: 'super' }}>™</span>
          </span>
          <span aria-hidden style={{ fontSize: 20, color: 'var(--ink-soft)' }}>
            ☰
          </span>
        </header>

        <main className="lc-hero">
          <div className="lc-hero-copy">
            <h1 className="lc-h1">The better 20&nbsp;minutes.</h1>
            <p
              style={{
                fontFamily: 'var(--serif)',
                fontStyle: 'italic',
                color: 'var(--leaf)',
                fontSize: 20,
                lineHeight: 1.35,
                margin: '0 0 14px',
              }}
            >
              A story they love.
              <br />
              Progress you can feel good about.
            </p>
            <p className="lc-lede" style={{ color: 'var(--ink-soft)', fontSize: 15, lineHeight: 1.6, maxWidth: 340 }}>
              AI writes a new chapter every day at exactly their level. They read. AI listens. The adventure continues
              tomorrow.
            </p>

            <div className="lc-features">
              {FEATURES.map((f) => (
                <div
                  key={f.label}
                  style={{
                    background: 'var(--card)',
                    border: '1px solid var(--line)',
                    borderRadius: 12,
                    padding: '10px 8px',
                    width: 100,
                    fontSize: 11.5,
                    lineHeight: 1.3,
                    color: 'var(--ink-soft)',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{f.emoji}</div>
                  {f.label}
                </div>
              ))}
            </div>
          </div>

          {/* Illustration stand-in: cozy reading moment (mockup: child + dog on the couch). */}
          <div
            className="lc-hero-art"
            aria-hidden
            style={{
              background: 'linear-gradient(180deg, #fdf6e6 0%, #f3e8d2 100%)',
              border: '1px solid var(--line)',
              borderRadius: 22,
              padding: 'clamp(26px, 6vw, 64px) 10px',
              fontSize: 'clamp(52px, 7vw, 88px)',
              letterSpacing: 8,
              textAlign: 'center',
            }}
          >
            <span style={{ display: 'inline-block', animation: 'lc-float 4s ease-in-out infinite' }}>🪴</span>
            <span>🧒📖</span>
            <span>🐕</span>
          </div>

          <div className="lc-hero-cta">
            <Link href="/setup" style={{ textDecoration: 'none' }}>
              <span className="btn-primary lc-cta">Try a Chapter Free Tonight</span>
            </Link>
            <p className="lc-cta-caption" style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '12px 0 6px' }}>
              $20/month after your first chapter.
            </p>
            <p className="lc-cta-caption" style={{ fontSize: 13, margin: 0 }}>
              <span style={{ color: 'var(--sunshine)', letterSpacing: 2 }}>★★★★★</span>{' '}
              <span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>Loved by parents</span>
            </p>
          </div>
        </main>

        <footer
          style={{
            fontSize: 11,
            color: 'var(--ink-soft)',
            borderTop: '1px solid var(--line)',
            padding: '14px 0 18px',
            textAlign: 'center',
          }}
        >
          littlechapters.com&nbsp;&nbsp;|&nbsp;&nbsp;Little Chapters™&nbsp;&nbsp;|&nbsp;&nbsp;All rights reserved
        </footer>
      </div>
    </div>
  );
}
