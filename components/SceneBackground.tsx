'use client';

/* Full-bleed story-scene background layer for Screens 3-5. Renders a real
 * <img> from `src` (curated local scene or, if re-enabled later,
 * chapter.visuals.*SceneUrl) behind the interactive UI. If the asset is
 * missing (no story-scene files shipped yet), it fails silently and lets the
 * ancestor's .lc-scenic/.lc-cliff CSS gradient show through instead of a
 * broken image — never falls back to a small interest icon. */

import { useEffect, useState } from 'react';

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
   *  child/subject well left- or right-of-center, not centered. Omit (or
   *  leave undefined) to keep the existing centered crop — every caller
   *  that hasn't been updated to pass one keeps its exact current framing. */
  focal?: { x: number; y: number };
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]); // new chapter/scene — give the new src a fresh try

  return (
    <div className={`lc-scene-bg${cliff ? ' lc-scene-bg--cliff' : ''}`} aria-hidden>
      {src && !failed && (
        <img
          src={src}
          alt=""
          onError={() => setFailed(true)}
          fetchPriority={priority ? 'high' : undefined}
          style={focal ? { objectPosition: `${focal.x * 100}% ${focal.y * 100}%` } : undefined}
        />
      )}
    </div>
  );
}
