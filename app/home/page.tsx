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
import { avatarEmoji, avatarImageObjectPosition, avatarImageSrc, loadProfile, type ChildProfile } from '@/lib/profile';
import { SpeakerIcon } from '@/components/icons/SpeakerIcon';
import { chapterFor, requestTutorChapter, selectStoryScene, type Chapter } from '@/lib/chapters';
import { wasChapterCompleted } from '@/lib/chapter-history';
import {
  pauseForBackground,
  playHomeSound,
  playTheme,
  prepareStoryAudio,
  speakPrompt,
  stopSpeaking,
  stopTheme,
  themeAssetFor,
  welcomeLine,
} from '@/lib/audio';

export default function ChildHomePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const pet = usePet(authLoading ? undefined : (user?.uid ?? null));
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

  // Prefetch/upgrade to the stage-matched tutor chapter — waits for auth to
  // settle (same reasoning as app/read/page.tsx's identical effect: a uid
  // is required to look up this child's persisted stage, and the anon
  // sign-in is still in flight at mount). Never blocks the instant demo-arc
  // render above; this only ever upgrades chapter in place once resolved.
  useEffect(() => {
    if (!profile || authLoading) return;
    let cancelled = false;
    const uid = user?.uid ?? null;
    void requestTutorChapter(profile, uid).then((generated) => {
      if (generated && !cancelled) setChapter(generated);
    });
    return () => {
      cancelled = true;
    };
  }, [profile, user, authLoading]);

  // Local-only and synchronous on purpose (see wasChapterCompleted) — reflects
  // completion the instant /read writes it, no Firestore round trip. Waits
  // for authLoading like usePet does: checking the anon slot before the real
  // uid resolves would flash "ready" for a returning signed-in child who
  // already finished today's chapter under their real uid.
  const alreadyRead = chapter && !authLoading ? wasChapterCompleted(user?.uid ?? null, chapter.id) : false;

  // Prepare the real flat theme asset; playback waits for a user gesture.
  // Owns theme for as long as Home is mounted, so unmount (any exit —
  // startChapter's own navigation stops nothing here on purpose, since the
  // theme is meant to continue seamlessly into /read) must stop the SAME
  // track it started. This previously called stopAmbience() — a different,
  // unused track — so theme never actually stopped here.
  useEffect(() => {
    if (profile) prepareStoryAudio(themeAssetFor(profile.interests[0]));
    return () => {
      stopTheme();
    };
  }, [profile]);

  // Backgrounding: stop welcome-line TTS immediately (resuming stale speech
  // after an unknown-length background gap makes no sense) and pause theme
  // if it happens to be playing. No explicit resume branch — Home has
  // nothing that should unconditionally restart itself on return; theme
  // only ever plays because of a fresh tap (startChapter/replayWelcome),
  // never as an ambient loop the idle screen owns on its own.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden) pauseForBackground();
    }
    function onPageHide() {
      stopSpeaking();
      stopTheme();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  function replayWelcome() {
    if (!profile) return;
    playHomeSound('replay.mp3');
    speakPrompt(welcomeLine(profile.childName, chapter, alreadyRead));
  }

  function startChapter() {
    // Presentation-only: compress the button, nudge the background, fade the
    // UI, THEN navigate — route/navigation logic is unchanged.
    playHomeSound('play.mp3');
    playTheme();
    setLeaving(true);
    setTimeout(() => router.push('/read'), 260);
  }

  if (!profile || !chapter || authLoading) return <div className="screen" />;

  const backgroundUrl = selectStoryScene(chapter.id, profile.interests);

  return (
    <div className={`screen lc-scenic lc-home-scene${leaving ? ' lc-leaving' : ''}`} style={{ position: 'relative' }}>
      <SceneBackground src={backgroundUrl} priority />

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
                overflow: 'hidden',
              }}
            >
              {avatarImageSrc(profile.avatar) ? (
                <img
                  src={avatarImageSrc(profile.avatar)!}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: avatarImageObjectPosition(profile.avatar) }}
                />
              ) : (
                avatarEmoji(profile.avatar)
              )}
            </span>
            {profile.childName}
          </span>
          <button className="icon-btn" aria-label="Settings" onClick={() => { playHomeSound('tap-soft.mp3'); stopTheme(); router.push('/parent'); }}>
            ⚙️
          </button>
        </header>

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 24px 0' }}>
          {/* Lightweight translucent title card — the environmental scene
              behind it already carries the story art, so this is a label,
              not a second illustration. Play intentionally overlaps its
              lower edge (negative margin on the button below). */}
          <div
            className="lc-card-in"
            style={{
              background: 'rgba(255,253,248,0.88)',
              borderRadius: 20,
              padding: '20px 30px 26px',
              marginTop: 30,
              boxShadow: '0 4px 16px rgba(43,43,43,0.14)',
              textAlign: 'center',
            }}
          >
            <span style={{ fontFamily: 'var(--serif)', fontWeight: 700, fontSize: 26, color: 'var(--dark)', lineHeight: 1.25 }}>
              {alreadyRead ? "Today's Chapter ✓" : "Today's Chapter"}
            </span>
          </div>

          {/* The one big button — the illustrated asset carries its own
              circle, shadow, and leaf motif, so the button itself stays
              transparent (no extra background/shadow to fight it). Overlaps
              the card's lower edge on purpose, per the design reference.
              Sequenced: fades in only once the card has mostly settled, and
              only starts its idle breathing once IT has settled in turn —
              never both firing from the moment the screen mounts. */}
          <button
            className="lc-play-btn"
            onClick={startChapter}
            aria-label={alreadyRead ? "Read today's chapter again" : "Start today's chapter"}
            style={{
              marginTop: -32,
              width: 85,
              height: 85,
              borderRadius: 999,
              border: 0,
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img src="/icons/play-primary.png" alt="" style={{ width: '112%', height: '112%', objectFit: 'contain' }} />
          </button>

          <button
            className="lc-fade-up lc-voice-prompt"
            onClick={replayWelcome}
            aria-label="Replay welcome message"
            style={{
              marginTop: 22,
              background: '#fffaf0',
              border: '1px solid var(--line)',
              borderRadius: 18,
              padding: '10px 14px',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              boxShadow: '0 2px 8px rgba(43,43,43,0.08)',
              cursor: 'pointer',
              animationDelay: '800ms',
            }}
          >
            {alreadyRead ? "You read today's chapter! See you tomorrow" : "There's a new chapter ready for you!"}
            <SpeakerIcon size={16} color="var(--blue)" />
          </button>

          {/* Momo: small, secondary, last to arrive — never competes with
              Play or the invitation above it. */}
          <div className="lc-momo-compact" style={{ width: '100%', maxWidth: 250, marginTop: 20 }}>
            <PetCompanion pet={pet} variant="child" />
          </div>
        </main>
      </div>
    </div>
  );
}

