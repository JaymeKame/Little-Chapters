# Decoding grader (MDD) — "did the child read the right word?"

Azure pronunciation assessment answers *"how native-like was this?"* — an L2
question, deliberately tolerant. A reading app for 5-year-olds needs a
different question answered: **word identity**. "Cat" read as "cot" is a
decoding failure; "cat" read with a lisp is correct decoding. Azure's STT
language model actively hides decoding failures by snapping misreadings back
to the expected word.

The fix (validated against speechocean762 expert scores, see calibration
below): a **lexicon-free phoneme recognizer** (wav2vec2 CTC,
`facebook/wav2vec2-xlsr-53-espeak-cv-ft`) transcribes what the child actually
said as phonemes; we compare that against the expected CMUdict pronunciation
(all variants) by edit distance. No language model → nothing snaps to the
expected word.

## Architecture

```
browser (lib/pronunciation.ts)
  ├─ Azure Speech SDK  ── websocket ──►  Azure   (transcript, fluency,
  │                                              prosody, phoneme scores)
  └─ WAV tap (WebAudio) ─► /api/reading/decode ─► mdd/server.py (this repo)
                                                  (per-word decode scores)
lib/reading-verdict.ts combines both into per-word needsHelp flags.
```

A word is flagged **only when both graders object** (`lib/reading-verdict.ts`,
`VERDICT_THRESHOLDS`): MDD word score < 70 AND Azure min-phoneme < 50. If the
MDD service is down, the app falls back to Azure-only (min-phoneme < 40) —
degraded but functional.

## Running the MDD service

```bash
cd mdd
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python server.py
```

First run downloads the ~1.3 GB model from HuggingFace. CPU-only, ~1–2 s per
clip — no GPU needed at v1 scale. Listens on `127.0.0.1:8010` (override:
`MDD_PORT`); the Next.js route finds it via `MDD_SERVER_URL`. Never expose it
to the public internet — the route (`app/api/reading/decode`) is the only
intended caller and carries the Firebase auth gate.

Words missing from CMUdict (kid names etc.): add to `MANUAL_PRONS` in
`mdd/grader.py`, or point `MDD_EXTRA_PRONS` at a JSON file
(`{"word": ["ARPABET1 ARPABET2 …"]}`). The service returns 422 UNKNOWN_WORD
listing the word when it hits one.

## Calibration (speechocean762, ages ≤7, 100 clips / 431 expert-scored words)

| System | word-level r | AUC (imperfect) | clearly-bad caught |
|---|---|---|---|
| Azure word scores | 0.11 | 0.70 | 0/3 → words passed at 70–91 |
| SpeechAce word scores | 0.24 | 0.61 | 2/3 |
| **MDD phoneme scores** | **0.32** | **0.79** | 3/3 |

Hybrid operating point (grid-searched on the 431 words): precision 0.34,
recall 0.49, 15/20 clearly-bad caught, 13.5% false flags on expert-perfect
words. Two caveats: the corpus is Chinese-L2 children scored under L2-lenient
criteria (some "false" flags are the grader correctly hearing accent — US-kid
precision should be better), and thresholds should be re-tuned when real
target-user recordings exist. Re-run the calibration with the scripts
preserved in the session scratchpad (`mdd-test.py`, `assess-batch.ts`,
threshold grid search) against any clip set with expert labels.
