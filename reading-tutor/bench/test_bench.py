#!/usr/bin/env python3
"""
Tests for the parts most likely to be silently wrong: the alignment and the
threshold sweep. Runs with no models and no audio.

    python3 test_bench.py
"""
import sys
from align import WordSpec, score_words, levenshtein_backtrace, phoneme_error_rate
from evaluate import Judgement, choose_operating_point, bootstrap_recall_ci, decide

passed = failed = 0
def ok(cond, label, extra=""):
    global passed, failed
    if cond:
        passed += 1; print(f"  ok   {label}")
    else:
        failed += 1; print(f"  FAIL {label}" + (f" -> {extra}" if extra else ""))

print("\nAlignment")
# "the cat sat" -> ð ə / k æ t / s æ t
spec = [
    WordSpec("the", ["ð", "ə"]),
    WordSpec("cat", ["k", "æ", "t"]),
    WordSpec("sat", ["s", "æ", "t"]),
]

r = score_words(spec, ["ð", "ə", "k", "æ", "t", "s", "æ", "t"])
ok(all(w.score == 1.0 for w in r), "a perfect read scores 1.0 on every word")

# Child says "cat" as "tat" - one phoneme wrong in the middle word only.
r = score_words(spec, ["ð", "ə", "t", "æ", "t", "s", "æ", "t"])
ok(r[0].score == 1.0, "the untouched word before is unaffected")
ok(abs(r[1].score - 2/3) < 1e-9, "the misread word drops to 2/3", str(r[1].score))
ok(r[2].score == 1.0, "the untouched word after is unaffected")

# Child skips a word entirely.
r = score_words(spec, ["ð", "ə", "s", "æ", "t"])
ok(r[1].score == 0.0, "a skipped word scores 0", str(r[1].score))
ok(r[0].score == 1.0 and r[2].score == 1.0, "its neighbours are unaffected")

# Child sounds it out, adding extra noise. Insertions must not punish.
r = score_words(spec, ["ð", "ə", "k", "k", "æ", "æ", "t", "s", "æ", "t"])
ok(all(w.score == 1.0 for w in r), "insertions do not penalise - sounding out is still reading")

ok(phoneme_error_rate(["k", "æ", "t"], ["k", "æ", "t"]) == 0.0, "PER of a perfect read is 0")
ok(phoneme_error_rate(["k", "æ", "t"], ["k", "æ", "t", "s", "s", "s", "s"]) > 1.0,
   "PER can exceed 1.0 - which is why clamping 1-PER at zero loses information")

print("\nThreshold sweep")
# Two tools. A is well calibrated. B assigns low scores to everything, so it
# cannot separate good reading from bad without falsely correcting children.
good = [Judgement(f"c{i}", "w", 0.9, True) for i in range(50)]
bad = [Judgement(f"c{i}", "w", 0.2, False) for i in range(50, 70)]
p = choose_operating_point("A", good + bad, 0.02)
ok(p.feasible, "a separable tool finds a safe threshold")
ok(p.error_recall == 1.0, "and catches every error", f"{p.error_recall}")
ok(p.false_reject_rate == 0.0, "with no false rejects", f"{p.false_reject_rate}")
ok(0.2 < p.threshold <= 0.9, "at a threshold between the two clusters", f"{p.threshold}")

overlap = ([Judgement(f"c{i}", "w", 0.5, True) for i in range(50)] +
           [Judgement(f"c{i}", "w", 0.5, False) for i in range(50, 70)])
p2 = choose_operating_point("B", overlap, 0.02)
ok(p2.error_recall == 0.0,
   "a tool that cannot separate them catches nothing inside the budget", f"{p2.error_recall}")
ok(p2.false_reject_rate <= 0.02, "and still respects the false-reject budget")

# The budget must actually bind.
mixed = ([Judgement(f"c{i}", "w", 0.4, True) for i in range(10)] +
         [Judgement(f"c{i}", "w", 0.9, True) for i in range(10, 50)] +
         [Judgement(f"c{i}", "w", 0.3, False) for i in range(50, 70)])
strict = choose_operating_point("C", mixed, 0.02)
loose = choose_operating_point("C", mixed, 0.30)
ok(strict.error_recall <= loose.error_recall,
   "a looser budget never catches fewer errors")
ok(strict.false_reject_rate <= 0.02, "the strict budget is respected", f"{strict.false_reject_rate}")
ok(loose.threshold >= strict.threshold, "and a looser budget allows a higher threshold")

print("\nHonesty about small samples")
lo, hi = bootstrap_recall_ci(good + bad, 0.5)
ok(hi - lo >= 0, "the CI is well formed")

# Three clips, one error each, and one of those errors scores ABOVE the
# correctly-read words so no safe threshold can catch it. Resampling clips
# then swings recall between 0 and 1 depending on which clips are drawn.
tiny = [
    Judgement("a", "w1", 0.90, True), Judgement("a", "w2", 0.30, False),
    Judgement("b", "w1", 0.90, True), Judgement("b", "w2", 0.30, False),
    Judgement("c", "w1", 0.90, True), Judgement("c", "w2", 0.95, False),
]
p3 = choose_operating_point("tiny", tiny, 0.02)
lo3, hi3 = bootstrap_recall_ci(tiny, p3.threshold)
ok(hi3 - lo3 > 0.2, "three errors give a very wide interval", f"{lo3:.2f}-{hi3:.2f}")

verdict = decide([
    (choose_operating_point("X", good + bad, 0.02), (0.90, 1.00)),
    (choose_operating_point("Y", good + bad, 0.02), (0.85, 1.00)),
])
ok("NO CLEAR WINNER" in verdict, "overlapping intervals report no winner rather than a fake one")

sep = decide([
    (choose_operating_point("X", good + bad, 0.02), (0.90, 1.00)),
    (choose_operating_point("Y", overlap, 0.02), (0.00, 0.10)),
])
ok("WINNER" in sep and "NO CLEAR" not in sep, "a real separation is reported as a winner")
ok("confidence_floor" in sep, "and the verdict hands you the config value")

print(f"\n{passed} passed, {failed} failed\n")
sys.exit(1 if failed else 0)
