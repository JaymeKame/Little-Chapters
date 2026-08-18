# Phoneme benchmark

Answers one question, definitively, in a day:

> At a threshold where we almost never falsely tell a child they got a word
> wrong, how many of their real errors does each tool catch?

The tool that catches the most wins. The threshold it wins at becomes
`confidence_floor` in `content/config.json`.

## Run it

Everything below runs from **this `bench` directory**, not the repo root.

On Windows the command is `python`, not `python3` — `python3` hits a Microsoft
Store alias and fails with "Python was not found". On macOS and Linux use
`python3`.

```powershell
cd bench
python -m pip install jiwer numpy phonemizer espeakng-loader librosa transformers torch torchaudio
```

No `apt install espeak-ng`, and nothing to install by hand on Windows —
`espeakng-loader` ships the library as a wheel and the script points phonemizer
at it.

Then, in order:

```powershell
python run_benchmark.py --self-test    # 1. is the install right?
python test_bench.py                   # 2. is the maths right? (23 assertions, no models)
python make_manifest.py clips sentences.txt > manifest.json
                                       # 3. scaffold, then LABEL IT
python run_benchmark.py manifest.json --skip-models
                                       # 4. precomputed arms only, checks the manifest
python run_benchmark.py manifest.json  # 5. everything
```

Step 1 checks torch, torchaudio's `forced_align`, librosa, and — the one that
matters — that eSpeak's phonemes all exist in the model's vocabulary. If they
don't, every score is garbage, and the self-test refuses rather than letting you
find out from a plausible-looking result.

Step 3 gives you a manifest with every word marked `true`. Changing the ones the
child did not read is the ground truth, and it is the only part nobody can
automate for you.

`sentences.txt` is one line per clip, in filename order, containing what the
child was **asked** to read — not what they said.

## What ten clips gets you

Ten clips is around sixty words, of which maybe ten are misreads. Error recall
is measured on those alone.

Enough to **rule out a badly broken tool**. Not enough to rank two close ones.
The bootstrap resamples clips rather than words — words inside a clip are not
independent, since one child having a bad night correlates all of them — and
reports a 95% interval. If the intervals overlap the script says "no clear
winner" instead of inventing one.

That is a real outcome, not a failed test. If the tools tie on accuracy, decide
on cost, latency and privacy — and your privacy policy already promises you
never retain a child's voice, which argues for the local model.

If you want to actually separate two close tools, aim for ~30 misread words.
The scaffold prints your count so you know where you stand.

## What changed from the original script, and why

**The three numbers were not comparable.** PER-derived accuracy measures how
well a recogniser *transcribes*. Azure and SpeechAce return how *native-like* a
pronunciation is. Different questions, different units. Taking the max of the
three was going to produce a confident answer to a question nobody asked.

**Plain accuracy was the wrong target.** This product has an asymmetric cost
function you wrote yourself: a missed mistake costs nothing, falsely correcting
a child makes them feel stupid and the parent cancels. So the benchmark fixes
the false-reject rate at a budget you choose and compares tools on how many real
errors they catch inside it.

**`jiwer.wer()` gives one number per clip.** The engine needs a decision per
word. `align.py` keeps the Levenshtein backtrace and attributes matches back to
individual words, so every word gets its own score.

**`1.0 - per` clamped at zero threw away information.** PER exceeds 1.0 when the
recogniser hallucinates, which it will on a five-year-old. Clamping made a
catastrophic clip look merely bad.

**The model id did not exist.** `facebook/wav2vec2-lv60-espeak-cv8-phoneme` is
not a model. It is `facebook/wav2vec2-lv-60-espeak-cv-ft`.

**Whisper cannot do this.** `whisper-large-v3` has no phoneme mode and no
phoneme API — it emits orthographic text. It is included as a word-level
baseline instead, which is worth having: if plain word matching beats every
phoneme approach, you want to know that before building phoneme machinery.

**A fourth arm was missing.** See below.

## The arm most likely to win

The child is reading a sentence **you wrote**. You already know every word.

Open phoneme recognition throws that away and asks "what did they say?" — the
hardest possible question, and the one general models handle worst for
five-year-olds, because they are trained overwhelmingly on adult speech.
`wav2vec2-lv-60-espeak-cv-ft` was fine-tuned on Common Voice, which is adults.

Forced alignment asks "how well does this audio fit the words we expected?"
That is a much easier question and far more robust to children's speech. Both
arms use the same acoustic model, so any difference between them is the
technique alone.

## Two things that will silently ruin the result

**Your ground-truth phonemes must come from the same g2p the model was trained
with.** This model was fine-tuned on eSpeak phonemisations, so `make_g2p()` uses
eSpeak. Hand-written dictionary IPA will make every arm look terrible and you
will blame the tools. `--self-test` checks this.

**Phonemes are not characters.** eSpeak emits multi-character IPA: `ride` is
ɹ-aɪ-d, three phonemes, but `list('ɹaɪd')` gives four characters, and `judge`
becomes five tokens instead of three. Splitting on characters inflates every
phoneme count and corrupts every per-word score. `make_g2p()` uses phone-level
separation and asserts `ride` comes back as three phonemes before returning.

## Before you trust any of it

Have both specialists label a few of the same clips independently and check they
agree. If Christine and Sophie disagree about whether a child read a word, no
tool can be scored against that label. Human agreement is the ceiling on
everything this benchmark can measure.
