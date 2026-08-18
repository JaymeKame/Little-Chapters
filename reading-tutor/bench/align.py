"""
Phoneme alignment and per-word scoring.

This is the part your original script was missing. `jiwer.wer()` gives you one
number for a whole clip. You cannot make a per-word decision from that, and a
per-word decision is the only thing the product actually needs: for each word in
the sentence, did this child read it or not?

So we align the recognised phoneme sequence against the expected one, keep the
backtrace, and attribute matches back to individual words.
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Sequence


@dataclass
class WordSpec:
    """One word of the target sentence and the phonemes it should produce."""
    word: str
    phonemes: list[str]


@dataclass
class AlignedWord:
    word: str
    expected: list[str]
    matched: int
    total: int

    @property
    def score(self) -> float:
        """0-1. Fraction of the word's expected phonemes that were recognised."""
        return self.matched / self.total if self.total else 0.0


def levenshtein_backtrace(
    ref: Sequence[str], hyp: Sequence[str]
) -> list[tuple[int | None, int | None, str]]:
    """
    Align two phoneme sequences and return the edit path.

    Returns a list of (ref_index, hyp_index, op) where op is one of
    'match', 'sub', 'del', 'ins'. Deletions have hyp_index None, insertions
    have ref_index None.
    """
    n, m = len(ref), len(hyp)
    # d[i][j] = cost of aligning ref[:i] with hyp[:j]
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if ref[i - 1] == hyp[j - 1]:
                d[i][j] = d[i - 1][j - 1]
            else:
                d[i][j] = 1 + min(
                    d[i - 1][j - 1],  # substitution
                    d[i - 1][j],      # deletion
                    d[i][j - 1],      # insertion
                )

    path: list[tuple[int | None, int | None, str]] = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and ref[i - 1] == hyp[j - 1] and d[i][j] == d[i - 1][j - 1]:
            path.append((i - 1, j - 1, "match"))
            i, j = i - 1, j - 1
        elif i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + 1:
            path.append((i - 1, j - 1, "sub"))
            i, j = i - 1, j - 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            path.append((i - 1, None, "del"))
            i -= 1
        else:
            path.append((None, j - 1, "ins"))
            j -= 1
    path.reverse()
    return path


def score_words(spec: Sequence[WordSpec], recognised: Sequence[str]) -> list[AlignedWord]:
    """
    Align a recognised phoneme string against the expected words and produce a
    0-1 score per word.

    Insertions are deliberately ignored. A child who adds an extra sound while
    working a word out has still read it, and the product's whole bias is that
    we would rather miss a mistake than invent one.
    """
    flat: list[str] = []
    owner: list[int] = []          # which word each expected phoneme belongs to
    for wi, w in enumerate(spec):
        for p in w.phonemes:
            flat.append(p)
            owner.append(wi)

    matched = [0] * len(spec)
    for ref_i, _hyp_i, op in levenshtein_backtrace(flat, list(recognised)):
        if op == "match" and ref_i is not None:
            matched[owner[ref_i]] += 1

    return [
        AlignedWord(word=w.word, expected=w.phonemes, matched=matched[i], total=len(w.phonemes))
        for i, w in enumerate(spec)
    ]


def phoneme_error_rate(ref: Sequence[str], hyp: Sequence[str]) -> float:
    """
    Classic PER, kept for reference against your original approach.

    Note this can exceed 1.0 when the recogniser hallucinates - which it will,
    on a five-year-old. Your original script clamped `1 - per` at zero, which
    silently threw away the information that a clip was catastrophically bad.
    """
    if not ref:
        return 0.0 if not hyp else 1.0
    path = levenshtein_backtrace(ref, hyp)
    errors = sum(1 for _, _, op in path if op != "match")
    return errors / len(ref)
