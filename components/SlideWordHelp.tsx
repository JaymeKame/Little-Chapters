'use client';

/* Rung 2's slide-through word help: the child drags one handle left to right
 * across the tricky word's graphemes (segmentWord() in lib/help-ladder.ts),
 * one coloured segment per grapheme, then hears the whole word blended.
 *
 * Deliberately scoped to rung 2 only — rung 1 withholds the word on purpose
 * ("that word begins with {phoneme}"; see enterOrEscalateLadder's comment),
 * and this component always shows every letter, so it would defeat rung 1's
 * whole reason to exist. Rung 3 stays the existing full-sentence TTS
 * fallback. Nothing here touches rung escalation, beginListening(tricky), or
 * any interpretation/persistence code — this is presentation only, layered
 * in front of the same "Try the word" / "Keep going" buttons that already
 * exist below it.
 *
 * A single real <input type="range"> is the entire interactive surface —
 * native drag, tap-to-jump, and arrow-key stepping for mouse, touch, and
 * keyboard alike, with no hand-rolled pointer-event code to get wrong. Its
 * default appearance is fully replaced (see the -webkit-slider and
 * -moz-range pseudo-elements in globals.css) so the visible track can show
 * one hard-edged colour per grapheme. */

import { useEffect, useRef, useState } from 'react';
import { playUISound } from '@/lib/audio';
import type { WordSegment } from '@/lib/help-ladder';

const SEGMENT_COLORS = ['var(--leaf)', 'var(--sky)', 'var(--blue)', 'var(--sunshine)'];

function trackGradient(count: number): string {
  const stops: string[] = [];
  for (let i = 0; i < count; i++) {
    const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length];
    const from = (i / count) * 100;
    const to = ((i + 1) / count) * 100;
    stops.push(`${color} ${from}%`, `${color} ${to}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export function SlideWordHelp({
  word,
  segments,
  onComplete,
}: {
  /** The tricky word, exactly as it will be sent to speakPrompt() on
   *  completion — audio only, never rendered as text here. */
  word: string;
  segments: WordSegment[];
  /** Called exactly once, the first time the child reaches the final
   *  segment. The caller owns starting/ending `speaking` state around its
   *  own speakPrompt(word) call — this component never touches it directly,
   *  so the existing `phase === 'correction' && speaking` branch keeps
   *  hiding the mic/keep-going buttons during the blend exactly as it
   *  already does for rung 2/3's own lines. */
  onComplete: () => void;
}) {
  const [value, setValue] = useState(0);
  const [complete, setComplete] = useState(false);
  const lastTickedRef = useRef(0);
  const count = segments.length;

  // A new tricky word (rung escalated to a different word, or the page
  // advanced) must never inherit the previous word's mid-slide position.
  useEffect(() => {
    setValue(0);
    setComplete(false);
    lastTickedRef.current = 0;
  }, [word]);

  function handleChange(next: number) {
    setValue(next);
    // One tick per NEWLY entered segment — not per raw input event, which
    // fires continuously while dragging across a single wide segment.
    if (next > lastTickedRef.current) playUISound('/audio/tap-soft.mp3');
    lastTickedRef.current = Math.max(lastTickedRef.current, next);
    if (next >= count && !complete) {
      setComplete(true);
      onComplete();
    }
  }

  return (
    <div className={complete ? 'lc-slide-help lc-slide-complete' : 'lc-slide-help'}>
      <div className="lc-slide-letters" aria-hidden>
        {segments.map((s, i) => (
          <span key={i} className={i < value ? 'lc-slide-letter is-lit' : 'lc-slide-letter'}>
            {s.text}
          </span>
        ))}
      </div>

      <div className="lc-slide-track-wrap">
        <input
          type="range"
          className="lc-slide-range"
          min={0}
          max={count}
          step={1}
          value={value}
          onChange={(e) => handleChange(Number(e.target.value))}
          style={{ background: trackGradient(count) }}
          aria-label={`Slide across ${word} to sound it out`}
          aria-valuetext={value === 0 ? 'not started' : value >= count ? 'done, whole word' : `letter ${value} of ${count}`}
        />
      </div>

      <p className="lc-slide-caption" role="status">
        {complete ? 'Great job! Now say the whole word…' : 'Slide to sound it out.'}
      </p>
    </div>
  );
}
