'use client';

/* Screen 3 — Child home. Mockup: avatar + name, settings gear, "Today's
 * Chapter" book cover, one giant play button, bottom pill "There's a new
 * chapter ready for you!" — one big button, no reading needed. Momo the
 * reading pet lives here too (kept from the reading-app pet system, but
 * visually secondary — small, delayed entrance, never competing with Play).
 *
 * Story art: a REAL curated scene from public/images/scenes/ (see
 * lib/scene-manifest.ts — 57 individually-cropped production scenes) renders
 * as an immersive background layer (pointer-events: none) behind the real
 * DOM controls, which keep their own z-index and normal pointer behavior.
 * This is the chapter's OPENING scene (lib/scene-selector.ts's
 * selectSceneForPage against page 0) — semantic + character-continuity
 * matched, deterministic per chapter.id — stable while the child is in the
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
import { useEffect, useMemo, useState } from 'react';
import { PetCompanion, usePet } from '@/components/PetCompanion';
import { SceneBackground } from '@/components/SceneBackground';
import { useAuth } from '@/components/AuthProvider';
import { avatarEmoji, avatarImageObjectPosition, avatarImageSrc, fetchRemoteProfile, loadProfile, mirrorProfileRemote, saveProfile, type ChildProfile } from '@/lib/profile';
import { SpeakerIcon } from '@/components/icons/SpeakerIcon';
import { chapterDebugInfo, chapterFor, requestTutorChapter, type Chapter } from '@/lib/chapters';
import { selectSceneForPage } from '@/lib/scene-selector';
import { wasChapterCompleted } from '@/lib/chapter-history';
import { useEntitlement } from '@/lib/use-entitlement';
import {
  pauseForBackground,
  primeTutorAudio,
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

  // Boot flow: wait for Firebase auth to settle before concluding "no
  // profile exists". loadProfile() is a single global (not uid-scoped)
  // localStorage key, so on THIS device it resolves instantly regardless
  // of auth — but a returning subscriber on a NEW browser/device, or one
  // who cleared site data, has nothing there at all. Bouncing to '/'
  // (landing, the true new-visitor entry point) the instant that happens —
  // as this used to, unconditionally, on mount — is exactly the bug this
  // fixes: it cannot tell "genuinely new visitor" apart from "known
  // subscriber, wrong device" without first asking the server. A signed-in
  // non-anonymous uid gets that one extra check (fetchRemoteProfile);
  // nothing here ever blocks longer than auth itself already does.
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    void (async () => {
      const local = loadProfile();
      if (local) {
        setProfile(local);
        setChapter(chapterFor(local.interests[0], local.childName));
        // Opportunistic, best-effort: keeps the server mirror in sync so a
        // FUTURE device can recognize this same returning subscriber, even
        // though this device never needed it. Never blocks render.
        if (user && !user.isAnonymous) {
          void user.getIdToken().then((token) => mirrorProfileRemote(token, local)).catch(() => {});
        }
        return;
      }
      if (user && !user.isAnonymous) {
        const token = await user.getIdToken().catch(() => null);
        const remote = token ? await fetchRemoteProfile(token) : null;
        if (remote && !cancelled) {
          saveProfile(remote); // adopt locally too, so the next load is instant/local
          setProfile(remote);
          setChapter(chapterFor(remote.interests[0], remote.childName));
          return;
        }
      }
      if (!cancelled) router.replace('/');
    })();
    return () => {
      cancelled = true;
    };
  }, [router, user, authLoading]);

  // Prefetch/upgrade to the stage-matched tutor chapter — waits for auth to
  // settle (same reasoning as app/read/page.tsx's identical effect: a uid
  // is required to look up this child's persisted stage, and the anon
  // sign-in is still in flight at mount). Never blocks the instant demo-arc
  // render above; this only ever upgrades chapter in place once resolved.
  //
  // The ID token is required, not optional: without it, every call here
  // 401s server-side in production (requireReadingUser demands a Bearer
  // token once Admin credentials are configured) — silently, since the
  // caller already treats a failed response as "stay on the demo arc" —
  // so this screen's own generation attempt never actually reached OpenAI
  // even for a genuinely entitled subscriber. app/read/page.tsx's
  // equivalent effect already fetched a token; this one previously did not.
  useEffect(() => {
    if (!profile || authLoading) return;
    let cancelled = false;
    void (async () => {
      const uid = user?.uid ?? null;
      const authToken = user ? await user.getIdToken().catch(() => null) : null;
      const generated = await requestTutorChapter(profile, uid, authToken);
      if (generated && !cancelled) setChapter(generated);
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, user, authLoading]);

  // window.__chapterDebug() — the chapter-source twin of AuthProvider's
  // __authDebug and lib/audio.ts's __voiceDebug. Deliberately not gated on
  // NODE_ENV (next build always sets NODE_ENV=production) — exists to
  // answer "is the live app actually generating chapters, or silently
  // falling back to the demo skeleton pool?" from DevTools on the real
  // deployed app. Never exposes prompt text, model output, or credentials.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as unknown as { __chapterDebug: () => ReturnType<typeof chapterDebugInfo> }).__chapterDebug = chapterDebugInfo;
  }, []);

  // Local-only and synchronous on purpose (see wasChapterCompleted) — reflects
  // completion the instant /read writes it, no Firestore round trip. Waits
  // for authLoading like usePet does: checking the anon slot before the real
  // uid resolves would flash "ready" for a returning signed-in child who
  // already finished today's chapter under their real uid.
  const alreadyRead = chapter && !authLoading ? wasChapterCompleted(user?.uid ?? null, chapter.id) : false;

  // Paywall state for THIS chapter. `locked` is false until the check
  // settles, so Play never flickers into a locked state on a fast device —
  // and a chapter the child already finished is never locked (see
  // useEntitlement). The free demo chapter needs no account at all: this
  // only ever becomes true once one has been completed.
  const { locked } = useEntitlement(chapter?.id ?? null);

  // Home shows the chapter's OPENING scene (page 0) as its single cover
  // image — per-page progression is a /read concept. Memoized: selectSceneForPage()
  // writes to the recent-scene localStorage history as a side effect (see
  // lib/scene-selector.ts) — must run once per actual chapter change, not on
  // every unrelated re-render (called before the profile/chapter null-guard
  // below, per rules of hooks).
  const sceneSelection = useMemo(
    () => (chapter ? selectSceneForPage(chapter, chapter.pages[0], 0, profile?.avatar, user?.uid ?? null) : null),
    [chapter, profile?.avatar, user?.uid],
  );

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
    speakPrompt(welcomeLine(profile.childName, chapter, alreadyRead, locked));
  }

  function startChapter() {
    // Behind the paywall the tap goes to the parent screen instead — quietly,
    // with no theme music or "here we go" cue, because nothing is starting.
    if (locked) {
      playHomeSound('tap-soft.mp3');
      stopTheme();
      router.push('/unlock');
      return;
    }
    // Reuse this existing child gesture to unlock iOS audio output before
    // asynchronous tutoring speech begins on the reading screen.
    primeTutorAudio();
    // Presentation-only: compress the button, nudge the background, fade the
    // UI, THEN navigate — route/navigation logic is unchanged.
    playHomeSound('play.mp3');
    playTheme();
    setLeaving(true);
    setTimeout(() => router.push('/read'), 260);
  }

  if (!profile || !chapter || authLoading) return <div className="screen" />;

  return (
    <div className={`screen lc-scenic lc-home-scene${leaving ? ' lc-leaving' : ''}`} style={{ position: 'relative' }}>
      <SceneBackground src={sceneSelection?.asset.src ?? null} focal={sceneSelection?.asset.focal} priority />

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
              {/* `locked` and `alreadyRead` can never both be true — a
                  chapter this child already finished is never locked. */}
              {alreadyRead ? "Today's Chapter ✓" : locked ? 'The Next Chapter' : "Today's Chapter"}
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
            aria-label={
              locked
                ? "Unlock the next chapter"
                : alreadyRead
                  ? "Read today's chapter again"
                  : "Start today's chapter"
            }
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
            {locked
              ? 'Ask a grown-up to open the next chapter'
              : alreadyRead
                ? "You read today's chapter! See you tomorrow"
                : "There's a new chapter ready for you!"}
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
