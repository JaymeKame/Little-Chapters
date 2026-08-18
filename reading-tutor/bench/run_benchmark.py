#!/usr/bin/env python3
"""
The one-day test.

    python3 run_benchmark.py manifest.json --max-false-reject 0.02

Reads the manifest, runs every available arm over every clip, sweeps thresholds,
and prints a decision matrix plus a call.
"""

from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

from align import WordSpec
from evaluate import (
    Judgement, choose_operating_point, bootstrap_recall_ci, decide, format_matrix,
)


def load_manifest(path: Path) -> dict:
    data = json.loads(path.read_text())
    for clip in data["clips"]:
        n = len(clip["words"])
        for key in ("expert_correct",):
            if len(clip[key]) != n:
                raise SystemExit(
                    f"{clip['audio']}: {len(clip[key])} {key} for {n} words. "
                    f"Every word needs an expert label."
                )
        for prov, scores in clip.get("precomputed", {}).items():
            if len(scores) != n:
                raise SystemExit(
                    f"{clip['audio']}: {prov} gave {len(scores)} scores for {n} words. "
                    f"You are probably using the clip-level score instead of the "
                    f"per-word scores. Both APIs return both - use per-word."
                )
    return data


def build_specs(clip: dict, g2p, need_phonemes: bool) -> list[WordSpec]:
    specs = []
    for w in clip["words"]:
        phonemes = clip.get("phonemes", {}).get(w) or (g2p(w) if g2p else None)
        if not phonemes:
            if not need_phonemes:
                # Precomputed-only run. Scores arrive per word from the manifest,
                # so we never need to know how the word is pronounced.
                specs.append(WordSpec(word=w, phonemes=[]))
                continue
            raise SystemExit(
                f"No phonemes for '{w}'. Either add them to the manifest or install "
                f"espeak-ng (apt install espeak-ng / brew install espeak-ng) so they "
                f"can be generated with the same vocabulary the model was trained on."
            )
        specs.append(WordSpec(word=w, phonemes=phonemes))
    return specs


def make_g2p():
    """
    Phonemise with espeak-ng, because the model was fine-tuned on espeak output.

    This is the single most important detail in the whole benchmark. If your
    ground-truth phonemes come from a different g2p than the model's training
    vocabulary, every arm will look terrible and you will conclude the tools are
    bad when the mismatch is yours.
    """
    try:
        from phonemizer import phonemize
        from phonemizer.separator import Separator
    except ImportError:
        print("phonemizer not installed - phonemes must come from the manifest.\n")
        return None

    # phonemizer needs the espeak-ng shared library. Installing that system-wide
    # is a real nuisance on Windows, so prefer the pip-installable bundle and
    # fall back to a system install if it is not there.
    try:
        import espeakng_loader
        from phonemizer.backend.espeak.wrapper import EspeakWrapper
        EspeakWrapper.set_library(espeakng_loader.get_library_path())
        EspeakWrapper.set_data_path(espeakng_loader.get_data_path())
    except ImportError:
        pass  # fall through to a system espeak-ng, if one exists

    # Phone-level separation, NOT character splitting.
    #
    # espeak emits multi-character IPA symbols: 'ride' is ɹ-aɪ-d, three
    # phonemes, but list('ɹaɪd') gives four characters. Splitting on characters
    # inflates every phoneme count and corrupts every per-word score. 'judge'
    # becomes five tokens instead of three.
    sep = Separator(phone="|", word=" ", syllable="")

    def g2p(word: str) -> list[str]:
        out = phonemize(
            word, language="en-us", backend="espeak",
            strip=True, with_stress=False, preserve_punctuation=False,
            separator=sep,
        )
        return [p for p in out.replace(" ", "|").split("|") if p]

    # phonemizer imports cleanly even when the library is missing and only fails
    # on first use. Probe now so the failure is one clear line rather than a
    # stack trace halfway through the run.
    try:
        assert g2p("ride") == ["ɹ", "aɪ", "d"], g2p("ride")
    except AssertionError as e:
        print(f"espeak produced unexpected phonemes for 'ride': {e}")
        print("Check your phonemizer version before trusting any result.\n")
        return None
    except Exception as e:
        print(f"phonemizer is installed but espeak is not usable ({e}).")
        print("Try: pip install espeakng-loader\n")
        return None
    return g2p


def self_test() -> int:
    """
    Checks every prerequisite without needing clips, labels or a benchmark run.

    Run this first. It tells you exactly which piece is missing instead of
    failing three steps into a real run.
    """
    ok = True

    def check(label: str, fn):
        nonlocal ok
        try:
            detail = fn()
            print(f"  ok    {label}" + (f"  ({detail})" if detail else ""))
        except Exception as e:
            ok = False
            print(f"  MISS  {label}\n          {e}")

    print("\nChecking prerequisites\n")

    check("jiwer", lambda: __import__("jiwer") and "")
    check("numpy", lambda: __import__("numpy").__version__)

    def _g2p():
        g = make_g2p()
        if g is None:
            raise RuntimeError("see message above; try: pip install phonemizer espeakng-loader")
        got = g("judge")
        if got != ["dʒ", "ʌ", "dʒ"]:
            raise RuntimeError(f"expected dʒ-ʌ-dʒ for 'judge', got {got}")
        return "judge -> " + "-".join(got)
    check("espeak g2p (phone-separated)", _g2p)

    def _torch():
        import torch
        return f"torch {torch.__version__}"
    check("torch", _torch)

    def _ta():
        import torchaudio
        assert hasattr(torchaudio.functional, "forced_align"), \
            "this torchaudio has no forced_align; upgrade to 2.1 or newer"
        return f"torchaudio {torchaudio.__version__}"
    check("torchaudio + forced_align", _ta)

    check("librosa", lambda: __import__("librosa").__version__)

    def _vocab():
        from transformers import AutoTokenizer
        from providers import PHONEME_MODEL
        v = AutoTokenizer.from_pretrained(PHONEME_MODEL).get_vocab()
        g = make_g2p()
        missing = set()
        if g:
            for w in ["the", "cat", "sat", "ride", "judge", "book", "boat", "her", "chip"]:
                missing |= {p for p in g(w) if p not in v}
        if missing:
            raise RuntimeError(
                f"espeak produces phonemes the model has never seen: {sorted(missing)}. "
                f"Every score would be wrong. Do not run the benchmark until this is clean."
            )
        return f"{len(v)} tokens, no mismatches"
    check("model vocabulary matches espeak output", _vocab)

    print()
    if ok:
        print("All prerequisites present. You need clips and expert labels next.")
        print("Copy manifest.example.json to manifest.json and fill it in.\n")
        return 0
    print("Fix the items marked MISS above, then run --self-test again.\n")
    return 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest", type=Path, nargs="?")
    ap.add_argument("--self-test", action="store_true",
                    help="Verify the install without needing clips or labels.")
    ap.add_argument("--max-false-reject", type=float, default=0.02,
                    help="Budget for falsely telling a child they got a word wrong. "
                         "This is the number that matters. Default 2%%.")
    ap.add_argument("--skip-models", action="store_true",
                    help="Only evaluate precomputed scores. Useful for checking "
                         "the harness before downloading gigabytes of weights.")
    args = ap.parse_args()

    if args.self_test:
        return self_test()
    if args.manifest is None:
        ap.error("give me a manifest, or use --self-test")

    data = load_manifest(args.manifest)
    base = args.manifest.parent
    g2p = make_g2p()

    live = []
    if not args.skip_models:
        try:
            from providers import LocalPhonemeProvider, ForcedAlignProvider
            live = [LocalPhonemeProvider(), ForcedAlignProvider()]
        except Exception as e:
            print(f"Could not load local models ({e}). Continuing with precomputed only.\n")

    judgements: dict[str, list[Judgement]] = {}

    for clip in data["clips"]:
        audio = str(base / clip["audio"])
        specs = build_specs(clip, g2p, need_phonemes=bool(live))

        for prov in live:
            try:
                scores = prov.score_clip(audio, specs)
            except Exception as e:
                print(f"  {prov.name} failed on {clip['audio']}: {e}")
                continue
            judgements.setdefault(prov.name, []).extend(
                Judgement(clip["audio"], specs[i].word, scores[i], clip["expert_correct"][i])
                for i in range(len(specs))
            )

        for name, scores in clip.get("precomputed", {}).items():
            judgements.setdefault(name, []).extend(
                Judgement(clip["audio"], specs[i].word, scores[i], clip["expert_correct"][i])
                for i in range(len(specs))
            )

    if not judgements:
        print("No provider produced any scores. Nothing to compare.")
        return 1

    points = []
    for name, js in judgements.items():
        p = choose_operating_point(name, js, args.max_false_reject)
        ci = bootstrap_recall_ci(js, p.threshold)
        points.append((p, ci))

    points.sort(key=lambda x: x[0].error_recall, reverse=True)

    print("\n" + "=" * 84)
    print(f"Question: at a threshold that falsely corrects a child at most "
          f"{args.max_false_reject:.0%} of the time,")
    print("          how many of the child's real errors does each tool catch?")
    print("=" * 84 + "\n")
    print(format_matrix(points))
    print("\n" + "-" * 84)
    print(decide(points))
    print("-" * 84 + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
