'use client';

/* The help ladder's fallback for a word segmentWord() can't safely
 * decompose (an irregular sight word, or one using a grapheme not yet
 * introduced at this stage). Per the hard no-guessing rule, this NEVER
 * invents a phoneme-by-phoneme breakdown — it pronounces the WHOLE word
 * plainly, using the exact same speakPrompt() call already proven for
 * SlideWordHelp's completion blend, with a warm glow on the word for
 * exactly the duration of that speech. That glow is honestly just "the word
 * is glowing while it's being said," not a claim of per-phoneme sync — no
 * cross-browser Web Speech API reliably exposes per-phoneme boundary
 * timing, so this component never pretends to.
 *
 * On speech end the icon swaps from speaker to mic, using the exact same
 * lc-invite-pulse visual language already used by Home's Play button and
 * the ready-state mic invite — a child who's learned either recognizes this
 * transition without reading "your turn" anywhere. graphemeCueFor() and
 * rungLine() are untouched and still used elsewhere in the app; this
 * component deliberately never calls either — whole-word pronunciation
 * only, never a sound-by-sound cue for a word the app can't safely teach
 * that way. Nothing here touches rung escalation, beginListening(tricky),
 * or any interpretation/persistence code — presentation only, exactly like
 * its sibling SlideWordHelp. */

import { useEffect, useRef, useState } from 'react';
import { speakPrompt } from '@/lib/audio';

export function AudioWordHelp({
  word,
  onComplete,
}: {
  /** The tricky word — spoken via speakPrompt(word) and the only text shown
   *  large on the card. Never decomposed, never rendered with phonetic
   *  notation. */
  word: string;
  /** Called exactly once, the moment the word finishes playing and it
   *  becomes the child's turn — same contract as SlideWordHelp's
   *  onComplete. */
  onComplete: () => void;
}) {
  const [speaking, setSpeaking] = useState(false);
  const [yourTurn, setYourTurn] = useState(false);
  const firedRef = useRef(false);
  const disposedRef = useRef(false);

  // A new tricky word (rung escalated, or the page advanced) must always
  // re-pronounce from scratch, never inherit the previous word's state.
  useEffect(() => {
    disposedRef.current = false;
    setYourTurn(false);
    firedRef.current = false;
    setSpeaking(true);
    speakPrompt(word, {
      onEnd: () => {
        if (disposedRef.current) return;
        setSpeaking(false);
        setYourTurn(true);
        if (!firedRef.current) {
          firedRef.current = true;
          onComplete();
        }
      },
    });
    return () => {
      disposedRef.current = true;
    };
  }, [word]);

  return (
    <div className="lc-audio-help">
      <p className={speaking ? 'lc-tricky-word lc-audio-word-glow' : 'lc-tricky-word'}>{word}</p>
      <span
        aria-hidden
        className={`lc-audio-icon-wrap${yourTurn ? ' lc-invite-pulse' : speaking ? ' lc-speaking-active' : ''}`}
      >
        <img
          src={yourTurn ? '/icons/mic-listening.png' : '/icons/speaker-audio.png'}
          alt=""
          className="lc-audio-icon"
        />
      </span>
      <p className="lc-slide-caption" role="status">
        {yourTurn ? 'Your turn!' : 'Listen…'}
      </p>
    </div>
  );
}
