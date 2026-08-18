'use client';

/* Full-bleed story-scene background layer for Screens 3-5. Renders a real
 * <img> from `src` (curated local scene or, if re-enabled later,
 * chapter.visuals.*SceneUrl) behind the interactive UI. If the asset is
 * missing (no story-scene files shipped yet), it fails silently and lets the
 * ancestor's .lc-scenic/.lc-cliff CSS gradient show through instead of a
 * broken image — never falls back to a small interest icon. */

import { useEffect, useState } from 'react';

export function SceneBackground({ src, cliff = false }: { src: string | null; cliff?: boolean }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]); // new chapter/scene — give the new src a fresh try

  return (
    <div className={`lc-scene-bg${cliff ? ' lc-scene-bg--cliff' : ''}`} aria-hidden>
      {src && !failed && <img src={src} alt="" onError={() => setFailed(true)} />}
    </div>
  );
}
