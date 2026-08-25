'use client';

/* Full-bleed story-scene background layer for Screens 3-5. Renders a real
 * <img> from `src` (curated local scene or generated chapter-scene package)
 * behind the interactive UI. If the asset is missing, it fails silently and
 * lets the ancestor's .lc-scenic/.lc-cliff CSS gradient show through — never
 * falls back to a small interest icon.
 *
 * Correction pass 2, Section 5: when `src` changes, the new image cross-fades
 * over the previous one instead of popping — the incoming layer is preloaded
 * (a hidden <img> with the new src) and only replaces the current layer once
 * it has loaded, so the child never sees a blank frame between scenes. */

import { useEffect, useRef, useState } from 'react';

export function SceneBackground({
  src,
  cliff = false,
  priority = false,
  focal,
}: {
  src: string | null;
  cliff?: boolean;
  /** This scene is the first thing on screen (Home) and its URL is already
   *  known at render time (selectSceneForPage is deterministic) — hint the
   *  browser to fetch it ahead of lower-priority requests instead of at
   *  default image priority. Leave false on Read/chapter-end, which aren't
   *  the very first heavy asset the child waits on. */
  priority?: boolean;
  /** Per-asset focal point (0-1 fractions, from SceneAsset.focal in
   *  lib/scene-manifest.ts) so `object-fit: cover`'s crop keeps the actual
   *  subject in frame on tall/narrow viewports instead of always cropping
   *  around the image's geometric center — most story-scene art has its
   *  child/subject well left- or right-of-center, not centered. */
  focal?: { x: number; y: number };
}) {
  const [failed, setFailed] = useState(false);
  const [visibleSrc, setVisibleSrc] = useState<string | null>(src);
  const [incomingSrc, setIncomingSrc] = useState<string | null>(null);
  const preloadRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setFailed(false);
    if (!src || src === visibleSrc) { setIncomingSrc(null); return; }
    // Preload the incoming asset; only swap it in once it's actually ready.
    const preload = new Image();
    preloadRef.current = preload;
    preload.onload = () => {
      if (preloadRef.current !== preload) return; // superseded by a newer src change
      setVisibleSrc(src);
      setIncomingSrc(null);
    };
    preload.onerror = () => {
      if (preloadRef.current !== preload) return;
      // Failure — keep the current visible frame; caller may fall back to gradient.
      setIncomingSrc(null);
      if (!visibleSrc) setFailed(true);
    };
    setIncomingSrc(src);
    preload.src = src;
    return () => { if (preloadRef.current === preload) preloadRef.current = null; };
  }, [src, visibleSrc]);

  return (
    <div className={`lc-scene-bg${cliff ? ' lc-scene-bg--cliff' : ''}`} aria-hidden>
      {visibleSrc && !failed && (
        <img
          className="lc-scene-bg__layer lc-scene-bg__layer--visible"
          src={visibleSrc}
          alt=""
          onError={() => { if (!incomingSrc) setFailed(true); }}
          fetchPriority={priority ? 'high' : undefined}
          style={focal ? { objectPosition: `${focal.x * 100}% ${focal.y * 100}%` } : undefined}
        />
      )}
    </div>
  );
}
