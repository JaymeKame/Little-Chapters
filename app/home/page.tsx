'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PetCompanion, usePet } from '@/components/PetCompanion';
import { SceneBackground } from '@/components/SceneBackground';
import { useAuth } from '@/components/AuthProvider';
import { loadProfile, type ChildProfile } from '@/lib/profile';
import { chapterFor, selectChapterScenes, type Chapter } from '@/lib/chapters';
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
    // Sound + theme fire on the gesture itself — never after the route change.
    playHomeSound('play.mp3');
    playTheme();
    setLeaving(true);
    setTimeout(() => router.push('/read'), 260);
  }

  if (!profile || !chapter) return <div className="screen" />;

  const scenes = selectChapterScenes(chapter.id, profile.interests);

  return (
    <div className={`scene lc-home-scene${leaving ? ' lc-leaving' : ''}`}>
      <SceneBackground src={scenes.home} />
      <div className="lc-home-overlay" aria-hidden />
      <div className="screen lc-scene-content lc-home-shell">
        <header className="lc-home-header">
          <span className="lc-home-profile">
            <span aria-hidden className="lc-home-avatar" />
            <span>{profile.childName}</span>
          </span>
          <button
            className="icon-btn lc-settings-btn"
            aria-label="Settings"
            onClick={() => {
              playHomeSound('tap-soft.mp3');
              stopTheme();
              router.push('/parent');
            }}
          >
            ⚙️
          </button>
        </header>

        <main className="lc-home-main">
          <div className="lc-home-chapter-stack">
            <div className="lc-chapter-card">
              <span className="lc-chapter-card-title">
                Today&rsquo;s
                <br />
                Chapter
              </span>
            </div>

            <button className="lc-play-btn" onClick={startChapter} aria-label="Start today's chapter">
              <span aria-hidden className="lc-play-triangle" />
            </button>
          </div>

          <button className="lc-voice-prompt" onClick={replayWelcome} aria-label="Replay welcome message">
            There&rsquo;s a new chapter ready for you!&nbsp;&nbsp;
            <span aria-hidden>🔊</span>
          </button>

          <div className="lc-momo-compact">
            <PetCompanion pet={pet} variant="child" />
          </div>
        </main>
      </div>
    </div>
  );
}

