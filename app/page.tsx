'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { fetchRemoteProfile, loadProfile, saveProfile } from '@/lib/profile';
import { resolveRootEntry } from '@/lib/root-entry';
import { track } from '@/lib/analytics';

const FEATURES = [
  { label: 'Made for real life', src: '/images/landing/icon-made-for-real-life.png' },
  { label: 'Built around phonics', src: '/images/landing/icon-built-around-phonics.png' },
  { label: 'One new chapter a day', src: '/images/landing/icon-one-new-chapter-a-day.png' },
];

function LandingPage() {
  useEffect(() => { track('landing_view', { route: '/' }); }, []);
  return (
    <div className="lc-landing">
      <div className="lc-landing-inner">
        <header className="lc-landing-header">
          <span className="lc-brand">
            Little Chapters<span className="lc-brand-mark">™</span>
          </span>
          <span aria-hidden className="lc-menu">☰</span>
        </header>

        <main className="lc-landing-main">
          <div className="lc-landing-copy-column">
            <div className="lc-landing-copy lc-landing-copy-column">
              <h1 className="lc-h1">A short daily reading adventure.</h1>
              <p className="lc-subhead">
                A story they love.
                <br />
                Progress you can feel good about.
              </p>
              <p className="lc-lede">
                AI writes a new chapter every day at exactly their level. They read. AI listens. The adventure continues tomorrow.
              </p>
              <p className="lc-lede" style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6 }}>
                Little Chapters uses AI to personalize each chapter for your child, with safety and reading-level checks built in.
              </p>

              <div className="lc-feature-grid" aria-label="Little Chapters benefits">
                {FEATURES.map((feature) => (
                  <div key={feature.label} className="lc-feature">
                    <div className="lc-feature-graphic">
                      <img src={feature.src} alt="" className="lc-feature-image" />
                    </div>
                    <span>{feature.label}</span>
                  </div>
                ))}
              </div>

              <div className="lc-landing-copy-proof">
                <p className="lc-cta-caption lc-price">$20/month after your first chapter.</p>
                <p className="lc-cta-caption lc-social-proof">
                  <span aria-hidden>★★★★★</span>
                  <span>Loved by parents</span>
                </p>
              </div>
            </div>

          </div>

          <div className="lc-landing-art-wrap">
            <div className="lc-landing-art" aria-hidden>
              <img src="/images/landing/landing-reading-scene.jpg" alt="" />
            </div>
            <div className="lc-landing-cta lc-landing-cta-overlap">
              <Link href="/setup" style={{ textDecoration: 'none' }} onClick={() => track('setup_started', { route: '/' })}>
                <span className="btn-primary lc-cta">Try a Chapter Free Tonight</span>
              </Link>
            </div>
          </div>

        </main>

        <footer className="lc-footer">
          littlechapters.com&nbsp;&nbsp;|&nbsp;&nbsp;Little Chapters™&nbsp;&nbsp;|&nbsp;&nbsp;All rights reserved
        </footer>
      </div>
    </div>
  );
}

export default function RootEntryPage() {
  const router = useRouter();
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [showLanding, setShowLanding] = useState(false);

  useEffect(() => {
    if (authLoading) return;

    let cancelled = false;
    setShowLanding(false);

    void resolveRootEntry({
      isAuthenticated,
      loadLocalProfile: loadProfile,
      fetchRemoteProfile: async () => {
        if (!user || user.isAnonymous) return null;
        const token = await user.getIdToken().catch(() => null);
        return token ? fetchRemoteProfile(token) : null;
      },
      saveLocalProfile: saveProfile,
    }).then((destination) => {
      if (cancelled) return;
      if (destination === 'landing') setShowLanding(true);
      else router.replace(destination);
    });

    return () => {
      cancelled = true;
    };
  }, [authLoading, isAuthenticated, router, user]);

  if (showLanding) return <LandingPage />;

  return (
    <main className="page-shell" aria-busy="true" aria-label="Loading Little Chapters">
      <section className="card" style={{ textAlign: 'center' }}>
        <span className="lc-brand">
          Little Chapters<span className="lc-brand-mark">™</span>
        </span>
        <p className="muted" style={{ marginTop: 16 }}>Opening your next chapter…</p>
      </section>
    </main>
  );
}
