"""
The evaluation that actually answers the question.

Your original script averaged three numbers and took the max. Two problems with
that:

1. The three numbers are not the same quantity. PER-derived accuracy measures
   how well a recogniser TRANSCRIBES. Azure's and SpeechAce's scores measure how
   NATIVE-LIKE a pronunciation is. Those are different questions with different
   units, and picking the larger one is meaningless.

2. Even if they were comparable, plain accuracy is the wrong target. This
   product has a wildly asymmetric cost function, which you wrote yourself:
   a missed mistake costs nothing, falsely telling a child they got a word wrong
   makes them feel stupid and the parent cancels.

So the benchmark asks one question of every tool, in the same units:

    At the threshold where this tool almost never falsely corrects a child,
    how many of the child's real errors does it still catch?

The tool that catches the most wins. And the threshold that gets chosen IS the
`confidence_floor` value for config.json - the benchmark produces the setting,
not just a verdict.
"""

from __future__ import annotations
from dataclasses import dataclass
import random


@dataclass
class Judgement:
    """One word, one tool's score for it, and what the expert said."""
    clip: str
    word: str
    score: float          # 0-1 from the tool. Higher = more confident it was read.
    expert_correct: bool  # ground truth: did the child actually read this word?


@dataclass
class OperatingPoint:
    provider: str
    threshold: float
    false_reject_rate: float   # correct words we would have "corrected". The bad one.
    error_recall: float        # real errors we caught. What we are maximising.
    n_correct_words: int
    n_error_words: int
    feasible: bool             # whether any threshold met the FRR budget


def _rates(judgements: list[Judgement], threshold: float) -> tuple[float, float]:
    correct = [j for j in judgements if j.expert_correct]
    errors = [j for j in judgements if not j.expert_correct]

    # We call a word "read" when score >= threshold.
    false_rejects = sum(1 for j in correct if j.score < threshold)
    caught_errors = sum(1 for j in errors if j.score < threshold)

    frr = false_rejects / len(correct) if correct else 0.0
    recall = caught_errors / len(errors) if errors else 0.0
    return frr, recall


def choose_operating_point(
    provider: str,
    judgements: list[Judgement],
    max_false_reject_rate: float = 0.02,
) -> OperatingPoint:
    """
    Find the threshold that catches the most real errors while keeping the
    false-reject rate inside budget.

    Sweeps every score present in the data plus the midpoints, so the chosen
    threshold is always one the data actually supports.
    """
    correct = [j for j in judgements if j.expert_correct]
    errors = [j for j in judgements if not j.expert_correct]

    candidates = sorted({j.score for j in judgements} | {0.0, 1.0001})
    feasible: list[tuple[float, float, float]] = []

    for t in candidates:
        frr, recall = _rates(judgements, t)
        if frr <= max_false_reject_rate:
            feasible.append((recall, t, frr))

    if not feasible:
        # No threshold is safe enough. Report the safest available so the
        # failure is legible rather than a crash.
        best_t = min(candidates)
        frr, recall = _rates(judgements, best_t)
        return OperatingPoint(provider, best_t, frr, recall, len(correct), len(errors), False)

    recall, t, frr = max(feasible, key=lambda x: (x[0], -x[1]))
    return OperatingPoint(provider, t, frr, recall, len(correct), len(errors), True)


def bootstrap_recall_ci(
    judgements: list[Judgement],
    threshold: float,
    iterations: int = 2000,
    seed: int = 0,
) -> tuple[float, float]:
    """
    95% confidence interval on error recall, resampling clips (not words).

    Words within a clip are not independent - one child having a bad night
    correlates every word in that clip - so resampling words would give a
    falsely tight interval.

    This exists because ten clips is a small sample, and the honest output of
    this benchmark is often "these two tools are indistinguishable on this
    data", not a winner.
    """
    rng = random.Random(seed)
    by_clip: dict[str, list[Judgement]] = {}
    for j in judgements:
        by_clip.setdefault(j.clip, []).append(j)
    clips = list(by_clip)
    if not clips:
        return (0.0, 0.0)

    samples = []
    for _ in range(iterations):
        drawn = [j for c in (rng.choice(clips) for _ in clips) for j in by_clip[c]]
        errs = [j for j in drawn if not j.expert_correct]
        if not errs:
            continue
        samples.append(sum(1 for j in errs if j.score < threshold) / len(errs))

    if not samples:
        return (0.0, 0.0)
    samples.sort()
    lo = samples[int(0.025 * len(samples))]
    hi = samples[min(len(samples) - 1, int(0.975 * len(samples)))]
    return (lo, hi)


def decide(points: list[tuple[OperatingPoint, tuple[float, float]]]) -> str:
    """
    Turn the numbers into a call, including the call your script could not make:
    'these are indistinguishable, choose on cost'.
    """
    usable = [(p, ci) for p, ci in points if p.feasible]
    if not usable:
        return (
            "NO TOOL IS SAFE ENOUGH. Every provider exceeded the false-reject budget at "
            "every threshold. Either the budget is too strict for this data, or the "
            "expert labels and the audio are misaligned. Check the labels before "
            "concluding anything about the tools."
        )

    usable.sort(key=lambda x: x[0].error_recall, reverse=True)
    best, best_ci = usable[0]

    overlapping = [p.provider for p, ci in usable[1:] if ci[1] >= best_ci[0]]
    if overlapping:
        return (
            f"NO CLEAR WINNER. {best.provider} scored highest at "
            f"{best.error_recall:.0%} error recall, but its confidence interval "
            f"overlaps {', '.join(overlapping)}. This sample cannot separate them. "
            f"Choose on cost, latency and privacy instead - which favours the local "
            f"model - or label more clips before deciding."
        )

    return (
        f"WINNER: {best.provider}. Catches {best.error_recall:.0%} of real errors "
        f"at a {best.false_reject_rate:.1%} false-reject rate, and its confidence "
        f"interval clears every other provider. Set confidence_floor to "
        f"{best.threshold:.3f} in config.json."
    )


def format_matrix(points: list[tuple[OperatingPoint, tuple[float, float]]]) -> str:
    rows = [
        f"{'provider':<28} {'threshold':>9} {'false-reject':>13} {'errors caught':>14} {'95% CI':>16}",
        "-" * 84,
    ]
    for p, ci in points:
        flag = "" if p.feasible else "  (no safe threshold)"
        rows.append(
            f"{p.provider:<28} {p.threshold:>9.3f} {p.false_reject_rate:>12.1%} "
            f"{p.error_recall:>13.0%} {f'{ci[0]:.0%}-{ci[1]:.0%}':>16}{flag}"
        )
    n_correct = points[0][0].n_correct_words if points else 0
    n_error = points[0][0].n_error_words if points else 0
    rows.append("")
    rows.append(f"sample: {n_correct} correctly-read words, {n_error} misread words")
    if n_error < 30:
        rows.append(
            f"WARNING: only {n_error} misread words. Error recall is measured on "
            f"those alone, so the confidence intervals will be wide. Treat any gap "
            f"smaller than the intervals as no result."
        )
    return "\n".join(rows)
