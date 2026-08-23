'use client';

/* The help ladder's fallback for a word segmentWord() can't safely
 * decompose (an irregular sight word, or one using a grapheme not yet
 * introduced at this stage). Per the hard no-guessing rule, this NEVER
 * invents a phoneme-by-phoneme breakdown — it pronounces the WHOLE word
 * plainly. The parent correction transition owns the unified speakPrompt()
 * request; this component reflects that lifecycle with a warm glow for
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
 * component deliberately owns neither copy nor speech — whole-word pronunciation
 * only, never a sound-by-sound cue for a word the app can't safely teach
 * that way. Nothing here touches rung escalation, beginListening(tricky),
 * or any interpretation/persistence code — presentation only, exactly like
 * its sibling SlideWordHelp. */

import { SpeakerIcon } from '@/components/icons/SpeakerIcon';
import { MicIcon } from '@/components/icons/MicIcon';

export function AudioWordHelp({
  word,
  speaking,
  ready,
}: {
  /** The tricky word — spoken via speakPrompt(word) and the only text shown
   *  large on the card. Never decomposed, never rendered with phonetic
   *  notation. */
  word: string;
  speaking: boolean;
  ready: boolean;
}) {
  return (
    <div className="lc-audio-help">
      <p className={speaking ? 'lc-tricky-word lc-audio-word-glow' : 'lc-tricky-word'}>{word}</p>
      <span
        aria-hidden
        className={`lc-audio-icon-wrap${ready ? ' lc-invite-pulse' : speaking ? ' lc-speaking-active' : ''}`}
      >
        {ready ? (
          <MicIcon className="lc-audio-icon" color="var(--leaf)" />
        ) : (
          <SpeakerIcon className="lc-audio-icon" color="var(--blue)" />
        )}
      </span>
      <p className="lc-slide-caption" role="status">
        {ready ? 'Your turn!' : 'Listen…'}
      </p>
    </div>
  );
}
