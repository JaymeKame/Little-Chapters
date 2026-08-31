'use client';

import { useEffect, useState } from 'react';
import type { Chapter } from '@/lib/chapters';
import { visualProvenance, type ChapterScenePackage } from '@/lib/chapter-scenes';

export function RuntimeDebugBadge({ chapter, scenePackage }: { chapter: Chapter | null; scenePackage: ChapterScenePackage | null }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => setVisible(new URLSearchParams(window.location.search).get('debug') === '1'), []);
  if (!visible) return null;
  const storyGenerated = chapter?.provenance?.source === 'generated' || chapter?.provenance?.source === 'cached-generated';
  const visual = visualProvenance();
  return (
    <aside className="lc-runtime-debug-badge" aria-label="Runtime provenance">
      <span>Story: {storyGenerated ? 'GENERATED' : `FALLBACK${chapter?.provenance?.failureReason ? ` — ${chapter.provenance.failureReason}` : ''}`}</span>
      <span>Visuals: {scenePackage ? 'GENERATED' : `STATIC FALLBACK${visual.failureReason ? ` — ${visual.failureReason}` : ' — no-package'}`}</span>
    </aside>
  );
}
