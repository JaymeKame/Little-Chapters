/* Adapter: live speech/measurement layer → reading-tutor's WordSignal contract.
 *
 * lib/pronunciation.ts (Azure) and lib/reading-verdict.ts (Azure+MDD hybrid
 * verdicts) measure. reading-tutor/src/interpret.ts judges. This file's only
 * job is reshaping one side's output into the other's input — it makes no
 * pedagogical decisions and duplicates none of interpretSession()'s logic.
 * See docs/INTEGRATION_SPINE.md for the field-by-field reasoning.
 *
 * Scope: takes the ALREADY reference-aligned words from one
 * ReadingAssessmentResult (Omissions/Insertions synthesized by
 * lib/pronunciation.ts's aggregate()/alignWords() — see that file's doc
 * comment for why continuous-mode Azure needs this client-side realignment).
 * One ReadingAssessmentResult == one reading "take" of one page's text,
 * which is the live app's actual capture granularity today (see the
 * architecture map for the page-vs-sentence granularity note — this adapter
 * is agnostic to it; the caller decides how many SentenceResults a page
 * becomes). */

import type { WordScore } from './pronunciation.ts';
import { combineVerdicts, type DecodeResult } from './reading-verdict.ts';
import type { SentenceResult, WordSignal } from '../reading-tutor/src/types.ts';

/** Debug/tuning only — never fed into WordSignal, never passed to
 *  interpretSession(). Exists so the phoneme-level and MDD evidence that
 *  combineVerdicts() already computes isn't silently thrown away at this
 *  boundary, per the integration brief's explicit question about it. */
export interface WordSignalDiagnostic {
  word: string;
  azureAccuracy: number | null;
  azureMinPhoneme: number | null;
  decodeScore: number | null;
  decodeHeard: string | null;
  errorType: WordScore['errorType'];
}

export interface AdaptedSentence {
  signals: WordSignal[];
  diagnostics: WordSignalDiagnostic[];
  /** Same length/order as `signals` — interventions[i] is whether the LIVE
   *  system (combineVerdicts' needsHelp) already intervened on signals[i].
   *
   *  This is NOT a measurement, and it deliberately does NOT live on
   *  WordSignal: `confidence` on signals[i] stays the raw, untouched Azure
   *  word-accuracy translation no matter what this says. It is a fact about
   *  a decision that already happened elsewhere (combineVerdicts already
   *  computed it; this is a passthrough, not a new judgment), carried
   *  alongside the measurement it corresponds to so a caller CAN apply the
   *  Class A invariant downstream (see
   *  lib/reading-session-interpreter.ts and
   *  docs/HELP_BOUNDARY_VALIDATION.md) — this file does not apply it.
   *  Unlike `diagnostics` (debug/tuning only, never consumed), this field
   *  is meant to be consumed — by that separate wrapper, never by anything
   *  in this file. */
  interventions: boolean[];
  /** Words Azure heard that were NOT in the reference text (re-reads, filler,
   *  made-up words). WordSignal has no slot for these — it is indexed by
   *  EXPECTED word — so they are dropped from `signals` by construction.
   *  Kept here only so they aren't silently invisible. */
  insertions: string[];
}

function minPhoneme(w: WordScore): number | null {
  const scores = w.phonemes.map((p) => p.accuracy).filter((a): a is number => a != null);
  return scores.length ? Math.min(...scores) : null;
}

/** words: ReadingAssessmentResult.words — already LCS-aligned against the
 *  reference text (see lib/pronunciation.ts alignWords()), so Omissions are
 *  already synthesized and Insertions are already labeled. decode: the MDD
 *  service's response for the same take, or null if it was unavailable —
 *  used ONLY to populate diagnostics, exactly like combineVerdicts already
 *  treats a null decode (Azure-only, no behavior change). */
export function toWordSignals(words: WordScore[], decode: DecodeResult | null = null): AdaptedSentence {
  // Reuses combineVerdicts' existing reference-order alignment between Azure
  // words and MDD decode words instead of re-deriving it — that alignment
  // logic already exists and is already correct; duplicating it here would
  // be exactly the kind of second interpretation system this adapter must
  // not become. Only azureAccuracy/azureMinPhoneme/decodeScore/decodeHeard/
  // errorType are read from the result — needsHelp/reason are judgment and
  // are discarded.
  const verdicts = combineVerdicts(words, decode);

  const signals: WordSignal[] = [];
  const diagnostics: WordSignalDiagnostic[] = [];
  const interventions: boolean[] = [];
  const insertions: string[] = [];

  // Running clock across the take, in ms, for gap_before_ms. The first word's
  // gap is measured from listening-start (t=0 at the first recognized
  // sample), which is real signal (hesitation before beginning), not a
  // placeholder — Azure's Offset already encodes it.
  let clockMs = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const v = verdicts[i];

    if (w.errorType === 'Insertion') {
      insertions.push(w.word);
      continue; // no expected-word slot exists for this — see AdaptedSentence doc
    }

    const heard = w.errorType !== 'Omission';
    const durationMs = heard ? (w.durationMs ?? 0) : 0;

    let gapBeforeMs: number;
    if (!heard || w.offsetMs == null) {
      // Omissions carry no real timestamp (see lib/pronunciation.ts
      // omissionOf()). The exact value is inert downstream: judge() in
      // interpret.ts returns 'missed' from `!heard` before ever inspecting
      // gap_before_ms, but 0 is the honest "we don't know" value rather than
      // fabricating a number that would look like real timing evidence.
      gapBeforeMs = 0;
    } else {
      gapBeforeMs = Math.max(0, w.offsetMs - clockMs);
    }
    if (w.offsetMs != null) clockMs = w.offsetMs + durationMs;

    // confidence: see docs/INTEGRATION_SPINE.md for the full comparison.
    // Short version — Azure's WORD-level AccuracyScore/100, not the
    // per-phoneme minimum and not the MDD decode score:
    //   1. It is the field that actually satisfies WordSignal's contract
    //      ("forced alignment against the EXPECTED word"). Azure's
    //      pronunciation assessment scores the word it was told to expect;
    //      MDD's lexicon-free CTC decode does not know which word was
    //      expected until AFTER decoding, which is structurally closer to
    //      the "open-vocabulary transcription confidence" the type's
    //      docstring explicitly rules out.
    //   2. Per the stated tiebreaker (minimize false-flagging a child who
    //      read correctly): CLAUDE.md's own calibration says Azure WORD
    //      scores are lenient enough to pass "every clearly-misread word at
    //      70-91" — i.e. they essentially never falsely fail a correct read.
    //      The phoneme minimum and MDD score are both calibrated specifically
    //      because they are MORE aggressive (that aggression is exactly why
    //      combineVerdicts requires both to agree before flagging anything);
    //      using either alone as `confidence` would push interpret.ts's
    //      already-gentle 0.35 floor into false 'stumbled' verdicts for
    //      words the child actually read fine.
    let confidence: number;
    if (!heard) {
      confidence = 0;
    } else if (w.errorType === 'Unassessed' || w.accuracy == null) {
      // Azure recognized something in this slot but returned no assessment
      // block at all (rare — see toWordScores() in lib/pronunciation.ts).
      // There is no word-level score to translate. 0 is a deliberate,
      // narrow null-handling choice, not a pedagogical judgment: it maps to
      // 'stumbled', not 'missed', because something WAS heard.
      confidence = 0;
    } else {
      confidence = Math.max(0, Math.min(1, w.accuracy / 100));
    }
    // NOT branched on v?.needsHelp. confidence is always the raw Azure
    // word-accuracy translation, full stop — even for a word live already
    // intervened on. See docs/HELP_BOUNDARY_VALIDATION.md: collapsing "what
    // the measurement was" and "what was decided about it" into one number
    // was the exact mechanism rejected there. That decision travels
    // separately, in `interventions` below.

    signals.push({
      word: w.word,
      confidence,
      duration_ms: durationMs,
      gap_before_ms: gapBeforeMs,
      heard,
    });

    diagnostics.push({
      word: w.word,
      azureAccuracy: w.accuracy,
      azureMinPhoneme: minPhoneme(w),
      decodeScore: v?.decodeScore ?? null,
      decodeHeard: v?.decodeHeard ?? null,
      errorType: w.errorType,
    });

    interventions.push(v?.needsHelp ?? false);
  }

  return { signals, diagnostics, interventions, insertions };
}

/** Thin convenience wrapper for callers assembling a SessionInput — still
 *  pure translation: assisted/reread are supplied by the caller (they
 *  describe how the reading happened, which the measurement layer has no
 *  way to know), never inferred here. */
export function toSentenceResult(
  index: number,
  referenceText: string,
  words: WordScore[],
  decode: DecodeResult | null = null,
  opts: { assisted?: boolean; reread?: boolean } = {},
): { sentence: SentenceResult; diagnostics: WordSignalDiagnostic[]; interventions: boolean[]; insertions: string[] } {
  const { signals, diagnostics, interventions, insertions } = toWordSignals(words, decode);
  return {
    sentence: {
      index,
      text: referenceText,
      words: signals,
      assisted: opts.assisted ?? false,
      reread: opts.reread ?? false,
    },
    diagnostics,
    interventions,
    insertions,
  };
}
