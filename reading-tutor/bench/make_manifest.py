#!/usr/bin/env python3
"""
Scaffolds a manifest from a folder of clips and the sentences they read.

    python3 make_manifest.py clips/ sentences.txt > manifest.json

sentences.txt: one line per clip, in filename order. The line is the sentence
the child was ASKED to read, not what they actually said.

Every word starts labelled `true`. Your job - or Christine's and Sophie's - is
to change the ones the child did not read to `false`. That editing pass is the
ground truth, and nothing this benchmark says is worth anything without it.
"""

from __future__ import annotations
import json
import sys
from pathlib import Path

AUDIO = {".wav", ".mp3", ".m4a", ".flac", ".ogg"}


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 1

    clip_dir, sentences_file = Path(sys.argv[1]), Path(sys.argv[2])
    clips = sorted(p for p in clip_dir.iterdir() if p.suffix.lower() in AUDIO)
    lines = [l.strip() for l in sentences_file.read_text().splitlines() if l.strip()]

    if not clips:
        print(f"No audio files in {clip_dir}", file=sys.stderr)
        return 1
    if len(clips) != len(lines):
        print(
            f"{len(clips)} clips but {len(lines)} sentences. They must match, in order.\n"
            f"clips: {[c.name for c in clips]}",
            file=sys.stderr,
        )
        return 1

    out = []
    for clip, line in zip(clips, lines):
        words = [w.strip(".,!?;:\"'").lower() for w in line.split()]
        words = [w for w in words if w]
        out.append({
            "audio": f"{clip_dir.name}/{clip.name}",
            "_sentence": line,
            "words": words,
            "expert_correct": [True] * len(words),
            "precomputed": {"azure": [], "speechace": []},
        })

    doc = {
        "_readme": [
            "SCAFFOLD - not ready to run yet. Two things to do:",
            "1. Set expert_correct to false for every word the child did not read.",
            "   Have two specialists do this independently and compare. If they",
            "   disagree, no tool can be scored against the label.",
            "2. Paste per-WORD scores from Azure and SpeechAce into precomputed,",
            "   one score per word, same order. Leave a provider out entirely",
            "   rather than filling it with placeholder numbers.",
            "Delete the _sentence fields when you are done; they are for your eyes.",
        ],
        "clips": out,
    }
    print(json.dumps(doc, indent=2, ensure_ascii=False))

    total = sum(len(c["words"]) for c in out)
    print(
        f"\n{len(out)} clips, {total} words to label.\n"
        f"Error recall gets measured only on the words you mark false, so if fewer\n"
        f"than about 30 come back false the result will not separate close tools.",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
