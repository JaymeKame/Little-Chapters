# Making the calibration clips

## What the child reads

`sentences.txt`, in order. Sixteen sentences, four each at stages 1, 3, 5 and 7,
all verified against the phonics validator so every word is genuinely decodable
at its stage. Four stages rather than one, so the threshold you end up with is
not tuned to a single vocabulary.

| clips | stage | example |
|---|---|---|
| 01-04 | 1 | Pip sat on my mat |
| 05-08 | 3 | The red hen sat on a log |
| 09-12 | 5 | The frog sat on a big stick |
| 13-16 | 7 | The bird sat on a card in the barn |

Sam is the child, Pip is the pet. If your reader is called something else,
change the names in `sentences.txt` and keep them one syllable and phonically
plain — the benchmark treats them as proper nouns and skips decoding checks, so
an awkward name adds noise for no benefit.

## The thing that decides whether this works

**You need misread words.** Error recall is measured only on words the child got
wrong. A child reading fluently at their own level produces maybe 5% errors —
sixteen clips would give you four or five misreads, and no tool can be ranked on
four data points.

So: **have each child read one or two stages ABOVE where they actually are.**

A stage-3 reader working through the stage-5 and stage-7 sheets will genuinely
struggle, and struggle is the signal. You want a mix — some sentences they sail
through, some they labour over, some they cannot do at all.

Aim for **roughly a third of words misread**. Around 30 misreads total is where
the confidence intervals get tight enough to separate two close tools. That is
likely 25-30 clips rather than 16, so run the sheet with two or three children.

Do not fake this with an adult performing a child. A five-year-old sounding out
a word has a different acoustic signature from an adult imitating one, and the
whole question is whether these tools handle real children's speech.

## What to capture

Record on **the device and microphone you plan to ship with**. A benchmark run
on a studio mic tells you nothing about a tablet on a duvet.

Include the messy cases — they are where the thresholds actually bind:

- a long pause before a word, then getting it
- sounding out letter by letter, then getting it
- starting wrong and self-correcting
- mumbling, or trailing off mid-word
- saying nothing at all
- background noise: a sibling, a television, a dog

One sentence per file. Name them so they sort in reading order: `clip01.wav`,
`clip02.wav`, and so on. Any of wav, mp3, m4a, flac or ogg works; wav is
simplest. Mono, 16kHz or higher — the pipeline resamples to 16kHz anyway.

Leave about half a second of silence at each end. Do not trim tightly, do not
apply noise reduction, do not normalise. Every one of those changes the acoustics
in a way that will not be there at runtime.

## Consent, and one thing worth pausing over

Your privacy policy promises: *"We never keep your child's voice. Recordings are
deleted the moment we've worked out which words they read."*

These clips are the exception. They are kept, replayed, and listened to by
adults. That is a materially different thing from what the policy describes, and
the parents of these children need to consent to it specifically and in writing —
not under the product's normal terms.

Two things to hold to, given you are building a COPPA-regulated product:

- These clips never go into any model training, yours or a vendor's. That is a
  separate promise in the same policy.
- Store them outside the production system, and decide now when they get
  deleted rather than later.

If any clip goes to Azure or SpeechAce for the precomputed scores, that is a
third-party disclosure of a child's voice and should be covered by the same
consent.

## Then

```powershell
mkdir clips
# put the recordings in, named clip01.wav upward
python make_manifest.py clips sentences.txt > manifest.json
```

Then open `manifest.json` and flip `expert_correct` to `false` for every word
the child did not read. Have Christine and Sophie do a few of the same clips
independently first — if they disagree about whether a word was read, no tool
can be scored against that label, and their agreement is the ceiling on
everything the benchmark can tell you.
