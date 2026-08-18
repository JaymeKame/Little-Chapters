#!/usr/bin/env python3
import json, sys, re
from collections import OrderedDict
from build_stages import (G, SEG, VOWEL_GRAPHEMES, SUFFIXES, MAX_CLUSTER,
                          MAX_SYLLABLES, SENTENCE_LEN)
from words import W, S, PROV, SPELLING_ONLY

CONS_LETTERS = set("bcdfghjklmnpqrstvwxyz")

def toks(blob):
    out, seen = [], set()
    for t in blob.split():
        if t.endswith("_x"):
            continue
        if t not in seen:
            seen.add(t); out.append(t)
    return out

def inv(stage):
    g = []
    for s in range(1, stage + 1):
        g += SEG[s]
    return sorted(set(g), key=len, reverse=True)

def segment(word, stage):
    """Best grapheme parse, or None. Prefers parses with the most vowel
    graphemes (so 'gem' parses g-e-m, not ge-m), then the fewest pieces."""
    inventory = inv(stage)
    allow_double = stage >= 7
    results = []

    def score(gs):
        v = sum(1 for g in gs if is_vowel(g, stage))
        # Must have a vowel; then take the FEWEST vowel graphemes, so 'away'
        # parses a-w-ay (2 syllables) rather than a-w-a-y (3).
        return (1 if v else 0, -v, -len(gs))

    def run(w, silent_e):
        n = len(w)
        memo = {}
        def go(i):
            if i == n:
                return []
            if i in memo:
                return memo[i]
            best = None
            cands = []
            if allow_double and i + 1 < n and w[i] == w[i+1] and w[i] in CONS_LETTERS \
               and w[i]*2 not in inventory:
                cands.append(w[i]*2)
            cands += [g for g in inventory if w.startswith(g, i)]
            # A bare final 'e' is never its own vowel in English at this level:
            # it is either silent (cake) or part of a larger grapheme (dge, ce, le).
            cands = [g for g in cands if not (g == "e" and i + 1 == n)]
            for gph in cands:
                rest = go(i + len(gph))
                if rest is not None:
                    cand = [gph] + rest
                    if best is None or score(cand) > score(best):
                        best = cand
            memo[i] = best
            return best
        r = go(0)
        if r is not None:
            results.append((r, silent_e))

    run(word, False)
    # Silent-e is the fallback: only reach for it if the word does not parse
    # directly (so 'apple' stays a-pp-le rather than becoming a-pp-l).
    if not results and stage >= 6 and len(word) >= 3 and word.endswith("e"):
        run(word[:-1], True)
    if not results:
        return None
    results.sort(key=lambda x: score(x[0]), reverse=True)
    return results[0]

def is_vowel(g, stage=10):
    if g == "y":
        return stage >= 8          # y is a consonant until stage 8
    return g in VOWEL_GRAPHEMES or (len(g) == 1 and g in "aeiou")

def has_vowel(gs, stage):
    return any(is_vowel(g, stage) for g in gs)

def check(word, stage):
    base, suffix = word, None
    for suf in sorted(SUFFIXES[stage], key=len, reverse=True):
        if word.endswith(suf) and len(word) - len(suf) >= 2:
            cand = word[:-len(suf)]
            p = segment(cand, stage)
            if p and has_vowel(p[0], stage):   # base must be a real syllable
                base, suffix = cand, suf
                break
    parsed = segment(base, stage)
    if not parsed:
        return False, "not segmentable"
    gs, silent_e = parsed
    syl = sum(1 for g in gs if is_vowel(g, stage)) + sum(1 for g in gs if g == "le")
    if syl == 0:
        return False, "no vowel"
    if syl > MAX_SYLLABLES[stage]:
        return False, f"{syl} syllables > max {MAX_SYLLABLES[stage]}"
    run_len = mx = 0
    for g in gs:
        if is_vowel(g, stage):
            run_len = 0
        else:
            run_len += 1
            mx = max(mx, run_len)
    if mx > MAX_CLUSTER[stage]:
        return False, f"consonant cluster of {mx} > max {MAX_CLUSTER[stage]}"
    return True, "-".join(gs) + (" + silent e" if silent_e else "") + (f" +{suffix}" if suffix else "")

# ---------------------------------------------------------------------------
failures, warnings = [], []
seen_decodable, seen_sight = {}, {}

for st in range(1, 11):
    for w in toks(W[st]):
        if w in seen_decodable:
            warnings.append(f"stage {st}: '{w}' already decodable at stage {seen_decodable[w]}")
            continue
        ok, why = check(w, st)
        if not ok:
            failures.append(f"stage {st}: '{w}' -> {why}")
        else:
            seen_decodable[w] = st
    for w in toks(S[st]):
        lw = w.lower()
        if lw in seen_sight:
            warnings.append(f"stage {st}: sight word '{w}' repeated (first at {seen_sight[lw]})")
        seen_sight[lw] = st
        if lw in seen_decodable and lw not in SPELLING_ONLY:
            warnings.append(f"stage {st}: sight word '{w}' is already decodable at stage {seen_decodable[lw]}")
        if lw not in PROV and w not in PROV:
            warnings.append(f"stage {st}: sight word '{w}' has no provenance entry")

print(f"FAILURES ({len(failures)}):")
for f in failures: print("  " + f)
print(f"\nWARNINGS ({len(warnings)}):")
for w in warnings: print("  " + w)

cum = 0
print("\nCounts:")
for st in range(1, 11):
    d = len([w for w in toks(W[st]) if seen_decodable.get(w) == st])
    s = len(toks(S[st]))
    cum += d + s
    print(f"  stage {st:2d}: +{d:4d} decodable  +{s:3d} sight   cumulative {cum}")

# ---------------------------------------------------------------------------
# Emit stages.json
# ---------------------------------------------------------------------------
from palettes import P, CONTENT_BLOCKLIST, HUMAN_NOUNS
from meta import M, SOURCES

cum_allowed, cum_palette = set(), {"nouns": [], "verbs": [], "adjectives": []}
stages = []

for st in range(1, 11):
    dec = [w for w in toks(W[st]) if seen_decodable.get(w) == st]
    sgt = toks(S[st])
    cum_allowed |= set(dec) | {w.lower() for w in sgt}

    pal_new = {k: v.split() for k, v in P[st].items()}
    for k in cum_palette:
        cum_palette[k] = sorted(set(cum_palette[k]) | set(pal_new[k]))
    banned = set(CONTENT_BLOCKLIST.split()) | set(HUMAN_NOUNS.split())
    for k, v in pal_new.items():
        for w in v:
            if w not in cum_allowed:
                failures.append(f"stage {st} palette {k}: '{w}' is not in the allowed set")
            if w in banned:
                failures.append(f"stage {st} palette {k}: '{w}' is blocklisted content")

    lo, hi = SENTENCE_LEN[st]
    m = M[st]
    stages.append(OrderedDict([
        ("id", st),
        ("label", m["label"]),
        ("focus", m["focus"]),
        ("note", m["note"]),
        ("source_alignment", OrderedDict([
            ("ufli", m["ufli"]),
            ("letters_and_sounds", m["las"]),
            ("deviation", m.get("dev")),
        ])),
        ("phonics", OrderedDict([
            ("new_graphemes", [OrderedDict([
                ("grapheme", g), ("phoneme", p), ("example", ex), ("vowel", v)
            ]) for g, p, ex, v in G[st]]),
            ("suffixes_available", SUFFIXES[st]),
            ("max_syllables", MAX_SYLLABLES[st]),
            ("max_consonant_cluster", MAX_CLUSTER[st]),
        ])),
        ("sight_words_introduced", sgt),
        ("decodable_words_introduced", sorted(dec)),
        ("example_words", sorted(dec)[:12]),
        ("sentence_length", OrderedDict([("min", lo), ("max", hi)])),
        ("generator_palette", OrderedDict([
            ("nouns", list(cum_palette["nouns"])),
            ("verbs", list(cum_palette["verbs"])),
            ("adjectives", list(cum_palette["adjectives"])),
        ])),
        ("counts", OrderedDict([
            ("new_decodable", len(dec)),
            ("new_sight", len(sgt)),
            ("cumulative_allowed", len(cum_allowed)),
        ])),
    ]))

prov = OrderedDict()
for st in range(1, 11):
    for w in toks(S[st]):
        src, dec_at = PROV.get(w, PROV.get(w.lower(), ("unknown", None)))
        prov[w] = OrderedDict([
            ("introduced_at_stage", st),
            ("list", src),
            ("becomes_decodable_at_stage", dec_at),
            ("irregularity", SPELLING_ONLY.get(w.lower())),
        ])

doc = OrderedDict([
    ("schema_version", "1.0.0"),
    ("generated", "2026-08-05"),
    ("language", "en-US"),
    ("target_ages", "5-7"),
    ("vocabulary_model", "cumulative"),
    ("readme", OrderedDict([
        ("allowed_set_rule",
         "The allowed word set for stage N is the union of "
         "decodable_words_introduced and sight_words_introduced for every stage "
         "1..N. Nothing outside that union, plus approved proper nouns, may "
         "appear in generated text."),
        ("palette_rule",
         "generator_palette is already cumulative and is the ONLY list the story "
         "generator may draw content words from. It excludes human nouns and "
         "anything frightening. The phonics validator checks against the full "
         "allowed set, which is wider - that gap is deliberate, so a child is "
         "never failed for a word the generator was allowed to use."),
        ("preview_words_rule",
         "At most 1-2 words from stage N+1's decodable_words_introduced may "
         "appear in a story, and only if they are also in stage N+1's "
         "generator_palette."),
        ("proper_nouns",
         "The child's own name and their pet's name are always allowed and are "
         "exempt from decodability checks. No other proper nouns are permitted."),
        ("caveat",
         "This sequence is a faithful reordering of published sources into ten "
         "stages, not a copy of any single published programme. Stage boundaries "
         "are editorial. Verify against the cited sources before shipping to "
         "children."),
    ])),
    ("sources", SOURCES),
    ("content_blocklist", sorted(set(CONTENT_BLOCKLIST.split()))),
    ("human_nouns", sorted(set(HUMAN_NOUNS.split()))),
    ("sight_word_provenance", prov),
    ("stages", stages),
])

if failures:
    print(f"\nBUILD FAILED - {len(failures)} problem(s)")
    for f in failures[:40]:
        print("  " + f)
    sys.exit(1)

with open("../content/stages.json", "w") as fh:
    json.dump(doc, fh, indent=2)
print("\nWrote stages.json")
