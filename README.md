# Little Chapters™

**The better 20 minutes.** AI writes a new chapter every day at exactly their
level. They read. AI listens. The adventure continues tomorrow.

A reading app for early readers (~age 5): a parent sets up a story profile in
under 30 seconds, the child reads today's chapter aloud one or two sentences
at a time, the app listens and helps gently ("Let's try that word together" —
never red, never blocking), and the parent gets a warm, score-free note about
what was practiced. Momo the reading pet grows with every chapter and gives
kids a reason to come back tomorrow.

## The flow

| Route | Screen |
|---|---|
| `/` | Landing page (for the parent) |
| `/setup` | Parent setup — name, age, pick 3 interests |
| `/home` | Child home — one big play button + Momo the pet |
| `/read` | Reading experience — live listening, gentle corrections, chapter-end cliffhanger |
| `/parent` | Parent message after each session |
| `/dev/assess` | Internal assessment harness (pipeline debugging) |

## How reading is judged

Two graders vote on every word (calibrated against expert phoneticians on
child speech — see [docs/DECODING_GRADER.md](docs/DECODING_GRADER.md)):

- **Azure Speech pronunciation assessment** (streaming) — transcript,
  fluency, prosody, per-phoneme scores
- **A lexicon-free wav2vec2 phoneme recognizer** (`mdd/`, self-hosted) —
  catches wrong-word decoding that Azure's language model hides

A word is flagged only when *both* object. If the MDD service is down, the
app degrades to Azure-only verdicts automatically.

## Setup

```bash
npm install
cp .env.local.example .env.local   # fill in Azure + Firebase values
npm run dev                        # http://localhost:3001
```

Azure Speech resource setup: [docs/AZURE_SPEECH_SETUP.md](docs/AZURE_SPEECH_SETUP.md).
The decoding service (optional but recommended):

```bash
cd mdd && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python server.py
```

Momo's design and the away-reminder roadmap: [docs/PET_SYSTEM.md](docs/PET_SYSTEM.md).

## Status

Demo chapter content is static (personalized by interest); the AI
chapter-writer, parent push messages, and accounts are the next milestones.
