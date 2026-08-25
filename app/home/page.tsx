'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SceneBackground } from '@/components/SceneBackground';
import { useAuth } from '@/components/AuthProvider';
import { avatarEmoji, avatarImageObjectPosition, avatarImageSrc, type ChildProfile } from '@/lib/profile';
import { chapterFor, latestChapterGenerationFailure, requestTutorChapter, type Chapter } from '@/lib/chapters';
import { selectSceneForPage } from '@/lib/scene-selector';
import { wasChapterCompleted } from '@/lib/chapter-history';
import { useEntitlement } from '@/lib/use-entitlement';
import { resolveProfile } from '@/lib/profile-repository';
import { resolveDailyState, type DailyStateKind } from '@/lib/entry-state';
import { resolvePreferences } from '@/lib/preferences';
import { themeAssetFor, welcomeLine } from '@/lib/audio';
import { audioSession } from '@/lib/audio-session';
import { resolveStoryInteractionManifest } from '@/lib/story-interactions';
import { requestChapterScenePackage, sceneUrl, type ChapterScenePackage } from '@/lib/chapter-scenes';
import { chapterDebugSnapshot, installChapterDebug } from '@/lib/adventure-debug';

export default function ChildHomePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<ChildProfile | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [profileUnavailable, setProfileUnavailable] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [handoffDismissed, setHandoffDismissed] = useState(false);
  const [handoffRequested, setHandoffRequested] = useState(false);
  const [scenePackage, setScenePackage] = useState<ChapterScenePackage | null>(null);
  const [chapterSettled, setChapterSettled] = useState(false);

  useEffect(() => {
    setHandoffRequested(new URLSearchParams(window.location.search).get('grownupHandoff') === '1');
  }, []);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    void Promise.all([resolveProfile(user), resolvePreferences(user)]).then(([resolved]) => {
      if (cancelled) return;
      if (!resolved.profile) {
        if (resolved.source === 'unavailable') setProfileUnavailable(true);
        else router.replace(user && !user.isAnonymous ? '/setup' : '/');
        return;
      }
      setProfile(resolved.profile);
      setChapter(chapterFor(resolved.profile.interests[0], resolved.profile.childName));
    });
    return () => { cancelled = true; };
  }, [router, authLoading, user]);

  useEffect(() => {
    if (!profile || authLoading) return;
    let cancelled = false; setChapterSettled(false);
    void (async () => {
      const authToken = user ? await user.getIdToken().catch(() => null) : null;
      return requestTutorChapter(profile, user?.uid ?? null, authToken);
    })().then((generated) => {
      if (generated && !cancelled) setChapter(generated);
      else if (!cancelled) setChapter((current) => current ? { ...current, provenance: { source: 'fallback', failureReason: latestChapterGenerationFailure() } } : current);
    }).finally(() => { if (!cancelled) setChapterSettled(true); });
    return () => { cancelled = true; };
  }, [profile, user, authLoading]);

  useEffect(() => {
    if (!chapter || authLoading || !chapterSettled) return;
    let cancelled = false; setScenePackage(null);
    void requestChapterScenePackage(chapter, resolveStoryInteractionManifest(chapter), user).then((value) => {
      if (!cancelled) setScenePackage(value);
    });
    return () => { cancelled = true; };
  }, [chapter, user, authLoading, chapterSettled]);

  const completedToday = Boolean(chapter && !authLoading && wasChapterCompleted(user?.uid ?? null, chapter.id));
  const entitlement = useEntitlement(chapter?.id ?? null);
  useEffect(() => installChapterDebug(() => chapterDebugSnapshot(chapter, scenePackage, undefined, {
    childId: profile?.childId, entitlementSource: entitlement.subscribed === true ? 'subscription' : 'free',
  })), [chapter, scenePackage, profile?.childId, entitlement.subscribed]);
  const forcedState = typeof window !== 'undefined' && process.env.NODE_ENV === 'development'
    ? new URLSearchParams(window.location.search).get('homeState') as DailyStateKind | null : null;
  const forcedOffline = typeof window !== 'undefined' && process.env.NODE_ENV === 'development'
    ? new URLSearchParams(window.location.search).get('homeState') === 'offline' : false;
  const dailyState: DailyStateKind = forcedState ?? resolveDailyState({
    resolved: Boolean(profile && chapter && entitlement.ready),
    completedToday,
    subscribed: entitlement.subscribed,
    freeChapterAvailable: !entitlement.freeChapterUsed,
  });

  const scene = useMemo(
    () => chapter ? selectSceneForPage(chapter, chapter.pages[0], 0, profile?.avatar, user?.uid ?? null) : null,
    [chapter, profile?.avatar, user?.uid],
  );

  useEffect(() => {
    if (profile) audioSession.prepareTheme(themeAssetFor(profile.interests[0]));
    return () => audioSession.stopTheme();
  }, [profile]);

  useEffect(() => {
    const visibility = () => document.hidden ? audioSession.background() : audioSession.foreground();
    const hide = () => { audioSession.cancelAll(); audioSession.stopTheme(); };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', hide);
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', hide); };
  }, []);

  function go(action: 'play' | 'grown-up') {
    audioSession.playHomeSound(action === 'play' ? 'play.mp3' : 'tap-soft.mp3');
    if (action === 'grown-up') { audioSession.stopTheme(); router.push('/settings'); return; }
    audioSession.playTheme(); setLeaving(true); setTimeout(() => router.push('/read'), 260);
  }

  if (profileUnavailable || forcedOffline) return <HomeError onRetry={() => window.location.reload()} />;
  if (!profile || !chapter || dailyState === 'loading') return <HomeLoading />;

  const copy = homeCopy(dailyState, chapter);
  const showGrownupHandoff = dailyState === 'completed' && handoffRequested && !handoffDismissed;
  const replay = () => audioSession.speak(welcomeLine(profile.childName, chapter, dailyState === 'completed', dailyState === 'locked'), { purpose: 'home-welcome' });

  return (
    <main className={`lc-home-v11${leaving ? ' is-leaving' : ''}`} data-home-state={dailyState}>
      <SceneBackground src={sceneUrl(scenePackage, 'scene-1') ?? scene?.asset.src ?? null} focal={scene?.asset.focal} priority />
      <div className="lc-home-scrim" />
      <header className="lc-home-v11-header">
        <div className="lc-child-mark">
          <span>{avatarImageSrc(profile.avatar) ? <img src={avatarImageSrc(profile.avatar)!} alt="" style={{ objectPosition: avatarImageObjectPosition(profile.avatar) }} /> : avatarEmoji(profile.avatar)}</span>
          <strong>{profile.childName}</strong>
        </div>
        <button className="lc-grownup-button" onClick={() => go('grown-up')} aria-label="Grown-up settings"><span aria-hidden>☼</span><small>Grown-ups</small></button>
      </header>

      <section className="lc-home-story" aria-labelledby="today-title">
        <p className="lc-home-kicker">{copy.kicker}</p>
        <div className={`lc-chapter-book is-${dailyState}`}>
          <div className="lc-book-stitch" aria-hidden />
          <span className="lc-book-mark" aria-hidden>{dailyState === 'completed' ? '✓' : '✦'}</span>
          <p>Little Chapters</p>
          <h1 id="today-title">{copy.title}</h1>
          <div className="lc-book-rule" />
          <h2>{chapter.character}&rsquo;s adventure</h2>
          <p className="lc-book-whisper">{copy.detail}</p>
        </div>

        {dailyState === 'locked' ? (
          <button className="lc-home-primary lc-home-grownup-primary" onClick={() => go('grown-up')}><span aria-hidden>⌂</span><strong>Ask a grown-up</strong><small>The next chapter is safe and waiting</small></button>
        ) : dailyState === 'completed' ? (
          <button className="lc-home-secondary-action" onClick={() => go('play')}><span aria-hidden>↻</span> Read again</button>
        ) : (
          <button className="lc-home-primary" onClick={() => go('play')} aria-label={dailyState === 'continue' ? 'Continue today’s adventure' : 'Play today’s adventure'}>
            <img src="/icons/play-primary.png" alt="" /><strong>{dailyState === 'continue' ? 'Continue' : 'Play'}</strong><small>{dailyState === 'continue' ? 'Your place is waiting' : 'Begin today’s adventure'}</small>
          </button>
        )}

        <button className="lc-home-listen" onClick={replay} aria-label="Hear this message"><span aria-hidden>◖</span>{copy.message}</button>
      </section>

      <footer className="lc-home-tomorrow"><span aria-hidden>☾</span><div><strong>{dailyState === 'completed' ? 'Tomorrow' : 'Today'}</strong><p>{dailyState === 'completed' ? chapter.teaser : 'A little mystery is waiting inside.'}</p></div></footer>
      {showGrownupHandoff && <div className="lc-grownup-handoff-backdrop" role="presentation">
        <section className="lc-grownup-handoff-card" role="dialog" aria-modal="true" aria-labelledby="save-adventure-title">
          <span className="lc-settings-eyebrow">For grown-ups</span>
          <h2 id="save-adventure-title">Save {profile.childName}&rsquo;s adventure</h2>
          <p>Create your parent account so tomorrow&rsquo;s chapter can continue where {profile.childName} left off.</p>
          <button className="btn-primary" onClick={() => router.push(user && !user.isAnonymous ? '/unlock' : '/register')}>Save the adventure</button>
          <button className="lc-handoff-later" onClick={() => setHandoffDismissed(true)}>Not now</button>
        </section>
      </div>}
    </main>
  );
}

function homeCopy(state: DailyStateKind, chapter: Chapter) {
  if (state === 'completed') return { kicker: 'Adventure complete', title: 'Today’s chapter', detail: 'Tucked safely into your storybook', message: `You helped ${chapter.character} today. Come back tomorrow!` };
  if (state === 'continue') return { kicker: 'Your adventure is underway', title: 'Continue today', detail: 'Your place is still marked', message: `${chapter.character} is ready when you are.` };
  if (state === 'locked') return { kicker: 'A new chapter is waiting', title: 'Tomorrow’s story', detail: 'A grown-up can open the storybook', message: 'Your adventure is resting here safely.' };
  return { kicker: 'A new story for today', title: 'Today’s chapter', detail: 'Written especially for you', message: `Ready to see what happens to ${chapter.character}?` };
}

function HomeLoading() { return <main className="lc-home-v11 lc-home-loading" data-home-state="loading"><div className="lc-loading-sky" /><div className="lc-loading-book"><span /><span /><span /></div><p>Opening today&rsquo;s story…</p></main>; }
function HomeError({ onRetry }: { onRetry: () => void }) { return <main className="lc-home-v11 lc-home-error" data-home-state="offline"><div className="lc-error-paper"><span aria-hidden>☁</span><h1>The storybook needs a moment.</h1><p>Your child&rsquo;s story is safe. Ask a grown-up to check the connection.</p><button className="btn-primary" onClick={onRetry}>Try again</button></div></main>; }
