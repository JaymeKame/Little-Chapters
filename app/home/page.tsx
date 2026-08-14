'use client';

/* Screen 3 — Child home. Mockup: avatar + name, settings gear, "Today's
 * Chapter" book cover, one giant play button, bottom pill "There's a new
 * chapter ready for you!" — one big button, no reading needed. Momo the
 * reading pet lives here too (kept from the reading-app pet system).        */

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PetCompanion, usePet } from '@/components/PetCompanion';
import { useAuth } from '@/components/AuthProvider';
import { loadProfile, type ChildProfile } from '@/lib/profile';

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
    <div className="screen" style={{ background: 'linear-gradient(180deg, #eef6ee 0%, var(--paper) 55%)' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
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
            🧒
          </span>
          {profile.childName}
        </span>
        <button className="icon-btn" aria-label="Settings" onClick={() => router.push('/parent')}>
          ⚙️
        </button>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 24px 0' }}>
        {/* Book cover */}
        <div
          style={{
            width: '100%',
            maxWidth: 300,
            borderRadius: 16,
            background: 'linear-gradient(165deg, #dcecd4 0%, #bcd9b0 55%, #a5cba1 100%)',
            border: '1px solid #b3c9a8',
            boxShadow: '0 10px 22px rgba(60, 90, 60, 0.18)',
            padding: '30px 20px 34px',
            textAlign: 'center',
            position: 'relative',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--serif)',
              fontSize: 30,
              color: '#2f4b33',
              display: 'block',
              marginBottom: 12,
            }}
          >
            Today&rsquo;s
            <br />
            Chapter
          </span>
          <span aria-hidden style={{ fontSize: 44 }}>
            🏡🐕
          </span>
        </div>

        {/* The one big button */}
        <button
          onClick={() => router.push('/read')}
          aria-label="Start today's chapter"
          style={{
            marginTop: -34,
            width: 96,
            height: 96,
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
              borderTop: '20px solid transparent',
              borderBottom: '20px solid transparent',
              borderLeft: '32px solid var(--leaf)',
              marginLeft: 8,
            }}
          />
        </button>

        <div
          style={{
            marginTop: 22,
            background: 'rgba(255,255,255,0.94)',
            border: '1px solid var(--line)',
            borderRadius: 999,
            padding: '12px 20px',
            fontSize: 14.5,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 2px 8px rgba(43,43,43,0.08)',
          }}
        >
          There&rsquo;s a new chapter ready for you!
          <span aria-hidden>🔊</span>
        </div>

        <div style={{ width: '100%', marginTop: 24 }}>
          <PetCompanion pet={pet} />
        </div>
      </main>
    </div>
  );
}
