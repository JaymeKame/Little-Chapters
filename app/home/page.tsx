'use client';

/* Screen 3 — Child home. Mockup: avatar + name, settings gear, "Today's
 * Chapter" book cover, one giant play button, bottom pill "There's a new
 * chapter ready for you!" — one big button, no reading needed. Momo the
 * reading pet lives here too (kept from the reading-app pet system, but
 * visually secondary — small, delayed entrance, never competing with Play).
 *
 * Story art: a REAL curated scene from public/images/landing/ (the only
 * place full story-scene illustrations currently exist on disk) renders as
 * an immersive background layer (pointer-events: none) behind the real DOM
 * controls, which keep their own z-index and normal pointer behavior.
 * Selection is interest-aware and deterministic per chapter.id (see
 * lib/chapters.ts selectStoryScene) — stable while the child is in the
 * chapter, never re-randomized on render/refresh, and never falls back to
 * a Parent Setup interest icon.
 *
 * The automatic AI-generation call was intentionally removed from this
 * page (see lib/chapters.ts requestChapterVisuals doc comment for why —
 * OPENAI_API_KEY/Firebase Storage are unconfigured in this environment, so
 * the call only ever returned 503 and silently fell back to a stretched
 * setup icon). Swapping chapter.visuals.homeSceneUrl back in later is a
 * one-line change once that backend is verified end-to-end.              */

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PetCompanion, usePet } from '@/components/PetCompanion';
import { SceneBackground } from '@/components/SceneBackground';
import { useAuth } from '@/components/AuthProvider';
import { avatarEmoji, loadProfile, type ChildProfile } from '@/lib/profile';
import { chapterFor, selectStoryScene, type Chapter } from '@/lib/chapters';
import { playHomeSound, playTheme, prepareStoryAudio, speakPrompt, stopAmbience, stopTheme, themeAssetFor, welcomeLine } from '@/lib/audio';

export default function ChildHomePage() {
  const router = useRouter();
  const { user } = useAuth();
  const pet = usePet(user?.uid ?? null);
  const [profile, setProfile] = useState<ChildProfile | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const p = loadProfile();
    if (!p) {
      router.replace('/');
      return;
    }
    setProfile(p);
    setChapter(chapterFor(p.interests[0], p.childName));
  }, [router]);

  // Prepare the real flat theme asset; playback waits for a user gesture.
  useEffect(() => {
    if (profile) prepareStoryAudio(themeAssetFor(profile.interests[0]));
    return () => {
      stopAmbience();
    };
  }, [profile]);

  function replayWelcome() {
    if (!profile) return;
    playHomeSound('replay.mp3');
    speakPrompt(welcomeLine(profile.childName, chapter));
  }

  function startChapter() {
    // Presentation-only: compress the button, nudge the background, fade the
    // UI, THEN navigate — route/navigation logic is unchanged.
    playHomeSound('play.mp3');
    playTheme();
    setLeaving(true);
    setTimeout(() => router.push('/read'), 260);
  }

  if (!profile || !chapter) return <div className="screen" />;

  const backgroundUrl = selectStoryScene(chapter.id, profile.interests);

  return (
    <div className={`screen lc-scenic lc-home-scene${leaving ? ' lc-leaving' : ''}`} style={{ position: 'relative' }}>
      <SceneBackground src={backgroundUrl} />

      <div className="lc-scene-content" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <header
          className="lc-fade-in"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px' }}
        >
          {/* Translucent chip keeps the name readable over busy story art. */}
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 15,
              fontWeight: 600,
              fontFamily: 'var(--serif)',
              background: 'rgba(255,253,248,0.85)',
              borderRadius: 999,
              padding: '3px 14px 3px 3px',
              boxShadow: '0 1px 4px rgba(43,43,43,0.12)',
            }}
          >
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
          <button className="icon-btn" aria-label="Settings" onClick={() => { playHomeSound('tap-soft.mp3'); stopTheme(); router.push('/parent'); }}>
            ⚙️
          </button>
        </header>

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 24px 0' }}>
          {/* Book cover — parchment double gold border, per the handoff */}
          <div
            className="lc-card-in lc-storybook"
            style={{
              width: '78%',
              maxWidth: 290,
              aspectRatio: '0.72',
              border: '4px double #c69b4c',
              background: '#fff2ce',
              borderRadius: 8,
              boxShadow: '10px 12px #4b663855',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              padding: '22px 16px 14px',
              marginTop: 14,
            }}
          >
            <span style={{ fontFamily: 'var(--serif)', fontWeight: 700, fontSize: 30, color: 'var(--dark)', lineHeight: 1.2 }}>
              Today&rsquo;s
              <br />
              Chapter
            </span>
            <div
              aria-hidden
              style={{
                width: '100%',
                flex: 1,
                minHeight: 100,
                marginTop: 16,
                borderRadius: 4,
                backgroundImage: `linear-gradient(rgba(255,242,206,0.12), rgba(20,92,58,0.2)), url(${backgroundUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                boxShadow: 'inset 0 0 0 1px rgba(126,92,37,0.18)',
              }}
            />
          </div>

          {/* The one big button */}
          <button
            className="lc-play-btn"
            onClick={startChapter}
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

          <button
            className="lc-fade-up--delay lc-voice-prompt"
            onClick={replayWelcome}
            aria-label="Replay welcome message"
            style={{
              marginTop: 22,
              background: '#fffaf0',
              border: '1px solid var(--line)',
              borderRadius: 18,
              padding: '10px 14px',
              fontSize: 13,
              textAlign: 'center',
              boxShadow: '0 2px 8px rgba(43,43,43,0.08)',
              cursor: 'pointer',
            }}
          >
            There&rsquo;s a new chapter ready for you!&nbsp;&nbsp;
            <span aria-hidden>🔊</span>
          </button>

          {/* Momo: small, secondary, delayed entrance — never competes with Play. */}
          {/* 210px left only ~86px for the message text, wrapping Momo's
              greeting to five lines. Momo stays visually secondary via
              .lc-momo-compact's smaller type — it does not need a hard cap
              this tight. */}
          <div className="lc-momo-compact" style={{ width: '100%', maxWidth: 320, marginTop: 10 }}>
            <PetCompanion pet={pet} variant="child" />
          </div>
        </main>
      </div>
    </div>
  );
}

