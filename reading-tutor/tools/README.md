# Stage file tooling

`content/stages.json` is generated, not hand-edited.

## Regenerating

Word lists live in `words.py`, palettes in `palettes.py`, editorial copy and
citations in `meta.py`, grapheme inventories and structure rules in
`build_stages.py`.

```
python3 emit.py        # validates, then writes ../content/stages.json
node check-stages.mjs  # independent invariant check on the emitted JSON
```

`emit.py` refuses to write if any word fails. It proves, per stage, that:

- the word segments into graphemes taught at or before that stage
- the syllable count is within the stage limit
- no consonant cluster exceeds the stage limit (blends are gated to stage 5+)
- suffixes are stripped only when the remaining base is a real syllable
- a bare final `e` is never treated as its own vowel (silent-e and `-dge`,
  `-ce`, `-le` are handled explicitly)

`check-stages.mjs` re-checks the emitted file from the outside: cumulative sets
are supersets, no word is introduced twice, every palette word is allowed and
not blocklisted, every sight word has provenance, every source has a URL.

## Adding words

Add to the relevant `W[n]` string in `words.py` and re-run `emit.py`. If the
word is not decodable at that stage the build fails and tells you why. Add to
`P[n]` in `palettes.py` only if the generator should be able to use it in a
story - that list is deliberately narrower.
