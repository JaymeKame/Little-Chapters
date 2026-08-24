'use client';

/* The help ladder's slide-through word help for a SEGMENTABLE word: the
 * child drags one handle left to right across the tricky word's graphemes
 * (segmentWord() in lib/help-ladder.ts), one coloured segment per grapheme,
 * while the tutor speaks the whole-word correction on entry. Shown as soon
 * as the word first becomes
 * tricky (rung 1) — see app/read/page.tsx's enterOrEscalateLadder for why a
 * second failure on an already-slid word skips straight to rung 3 rather
 * than repeating this. AudioWordHelp is its sibling for words segmentWord()
 * won't cover. Nothing here touches rung escalation, beginListening(tricky),
 * or any interpretation/persistence code — this is presentation only,
 * layered in front of the same "Try the word" / "Keep going" buttons that
 * already exist below it.
 *
 * A single real <input type="range"> is the entire interactive surface —
 * native drag, tap-to-jump, and arrow-key stepping for mouse, touch, and
 * keyboard alike, with no hand-rolled pointer-event code to get wrong. Its
 * default appearance is fully replaced (see the -webkit-slider and
 * -moz-range pseudo-elements in globals.css) so the visible track can show
 * one hard-edged colour per grapheme.
 *
 * The thumb gets a small idle left-right nudge (lc-slide-idle) while
 * untouched (value 0) — the ONLY hint that it's draggable a child doesn't
 * have to read is otherwise just its shape, and "drag me" is not always
 * obvious from a static circle alone. Stops the instant a real drag starts. */

import { useEffect, useRef, useState } from 'react';
import { playUISound, primeTutorAudio } from '@/lib/audio';
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
  /** The tricky word used for the accessible slider label. The parent
   *  correction state owns its single speakPrompt() call. */
  word: string;
  segments: WordSegment[];
  /** Called exactly once the first time the child reaches the final segment;
   *  the parent uses it to unlock the child's retry after correction help. */
  onComplete: () => void;
}) {
  const [value, setValue] = useState(0);
  const count = segments.length;
  // `complete` is DERIVED from value, never a separate latch: sliding back
  // off the end must honestly un-complete the caption/visuals immediately,
  // not leave them stuck showing "done" (a real bug caught by testing
  // backward-slide-after-completion — a native range's mousedown-anywhere
  // behavior can jump straight to the end before a drag even starts, so
  // "reached the end" is not a one-time event to latch).
  const complete = value >= count;
  // Separately tracks whether onComplete() has already fired for the
  // CURRENT approach to the end, so scrubbing back and forth near the last
  // segment doesn't replay the whole-word blend on every render — but
  // sliding all the way back off and reaching the end again SHOULD replay
  // it (repetition is fine practice, not a bug), hence resetting this in the
  // `else` branch below rather than latching it permanently like `complete`
  // used to.
  const firedRef = useRef(false);

  // A new tricky word (rung escalated to a different word, or the page
  // advanced) must never inherit the previous word's mid-slide position.
  useEffect(() => {
    setValue(0);
    firedRef.current = false;
  }, [word]);

  function handleChange(next: number) {
    primeTutorAudio(); // existing slider gesture re-establishes mobile output permission
    // With step={1}, every onChange already represents landing on a genuinely
    // new segment (the browser only fires onChange at integer boundaries) —
    // no extra "did this actually change" bookkeeping needed. Skip only the
    // "back to nothing selected yet" position (0), which isn't a real letter.
    if (next !== value && next > 0) playUISound('/audio/tap-soft.mp3');
    setValue(next);
    if (next >= count) {
      if (!firedRef.current) {
        firedRef.current = true;
        onComplete();
      }
    } else {
      firedRef.current = false;
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
          className={value === 0 ? 'lc-slide-range lc-slide-idle' : 'lc-slide-range'}
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
