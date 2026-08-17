'use client';

/* Screen 3 — Child home. Mockup: avatar + name, settings gear, "Today's
 * Chapter" book cover, one giant play button, bottom pill "There's a new
 * chapter ready for you!" — one big button, no reading needed. Momo the
 * reading pet lives here too (kept from the reading-app pet system).        */

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PetCompanion, usePet } from '@/components/PetCompanion';
import { useAuth } from '@/components/AuthProvider';
import { avatarEmoji, loadProfile, type ChildProfile } from '@/lib/profile';

export default function ChildHomePage() {
  const router = useRouter();
  const { user } = useAuth();
  const pet = usePet(user?.uid ?? null);
  const [profile, setProfile] = useState<ChildProfile | null>(null);

  useEffect(() => {
    const p = loadProfile();
    if (!p) {
      router.replace('/');
      return;
    }
    setProfile(p);
  }, [router]);

  if (!profile) return <div className="screen" />;

  return (
    <div className="screen lc-scenic">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, fontFamily: 'var(--serif)' }}>
          <span
            aria-hidden
            style={{
              width: 38,
              height: 38,
              borderRadius: 999,
              background: '#f6e7c8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              border: '2px solid #fff',
              boxShadow: '0 1px 4px rgba(43,43,43,0.12)',
            }}
          >
            {avatarEmoji(profile.avatar)}
          </span>
          {profile.childName}
        </span>
        <button className="icon-btn" aria-label="Settings" onClick={() => router.push('/parent')}>
          ⚙️
        </button>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 24px 0' }}>
        {/* Book cover — parchment with a double gold border, per the handoff */}
        <div
          style={{
            width: '78%',
            maxWidth: 290,
            minHeight: 240,
            border: '4px double #c69b4c',
            background: '#fff2ce',
            borderRadius: 8,
            boxShadow: '10px 12px #4b663855',
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            padding: '26px 16px',
            marginTop: 14,
          }}
        >
          <span style={{ fontFamily: 'var(--serif)', fontWeight: 700, fontSize: 30, color: 'var(--dark)', lineHeight: 1.2 }}>
            Today&rsquo;s
            <br />
            Chapter
          </span>
        </div>

        {/* The one big button */}
        <button
          onClick={() => router.push('/read')}
          aria-label="Start today's chapter"
          style={{
            marginTop: 26,
            width: 85,
            height: 85,
            borderRadius: 999,
            border: 0,
            background: '#fff',
            boxShadow: '0 6px 18px rgba(43,43,43,0.22)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 0,
              height: 0,
              borderTop: '18px solid transparent',
              borderBottom: '18px solid transparent',
              borderLeft: '28px solid var(--dark)',
              marginLeft: 7,
            }}
          />
        </button>

        <div
          style={{
            marginTop: 22,
            background: '#fffaf0',
            border: '1px solid var(--line)',
            borderRadius: 18,
            padding: '13px 20px',
            fontSize: 14,
            textAlign: 'center',
            boxShadow: '0 2px 8px rgba(43,43,43,0.08)',
          }}
        >
          There&rsquo;s a new chapter ready for you!&nbsp;&nbsp;
          <span aria-hidden>🔊</span>
        </div>

        {/* Momo: companion only — no XP/streak/score chrome for the child. */}
        <div style={{ width: '100%', marginTop: 22 }}>
          <PetCompanion pet={pet} variant="child" />
        </div>
      </main>
    </div>
  );
}
