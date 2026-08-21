# Story Image System

How Little Chapters' story-scene backgrounds (Home cover, `/read` per-page,
chapter-end) are built and selected, as of the 2026-08-21 production pass
that replaced the old interest-only pool with real, individually-cropped
artwork and a semantic page-level selector.

## Source artwork → production assets

Six composite sheets were supplied under `public/images/landing/` on
`main` (`ChatGPT Image Aug 20, 2026 at ...png`, ~2.5–2.9MB each). Each is a
grid of distinct scene illustrations, not a single image. They were:

1. Moved to `assets/story-scene-sources/` (repo root, **outside `public/`**)
   so they can never be served or accidentally used as a runtime background
   — the hard requirement "no runtime entry points at a composite/contact
   sheet" is enforced structurally, not just by convention.
2. Inspected pixel-by-pixel (not by filename) to determine each grid's real
   layout — a Python/PIL script scanned for near-white gutter bands
   column-wise and row-wise per file (`whitish_thresh=180`,
   `frac_thresh=0.4`), rather than assuming a uniform grid across all six
   files. Detected layouts:

| Source | Grid | Panels | Composition |
|---|---|---|---|
| `composite-01-solo-4x5.png` | 4×5 | 20 | Solo boy OR solo girl, varied themes |
| `composite-02-trio-4x4.png` | 4×4 | 16 | Boy+girl+dog trio (2 panels are boy+girl duo, no dog) |
| `composite-03-trio-3x3.png` | 3×3 | 9 | Boy+girl+dog trio |
| `composite-04-girldog-2x2.png` | 2×2 | 4 | Girl+dog pair |
| `composite-05-boydog-2x2.png` | 2×2 | 4 | Boy+dog pair |
| `composite-06-background-2x2.png` | 2×2 | 4 | No characters — environment only |

**57 production scenes total.** Each panel was cropped at its detected
gutter boundaries plus a 3px inward safety trim (kills any anti-aliased
edge halo), re-encoded as JPEG (quality 93, no upscaling — native panel
resolution preserved), and saved under `public/images/scenes/` with a
deterministic semantic filename (`{theme}-{characters}-{seq}.jpg`, e.g.
`ocean-lighthouse-` → `pair-girl-dog-beach-lighthouse-sunset-01.jpg`).

Every crop was spot-checked visually against its source panel (inner
panels bordered on all four sides included, to prove the boundary
detection generalizes, not just edge panels) — no white gutters, no
neighboring-panel bleed, correct orientation, no baked text anywhere in
the supplied artwork.

## Manifest — `lib/scene-manifest.ts`

One `SceneAsset[]` array, 57 entries, hand-built from actually viewing each
cropped panel (not inferred from filenames). Fields: `id`, `src`,
`width`/`height`, `sourceFile`/`sourcePanel` (provenance back to the
composite + grid cell), `theme`, `environment`, `indoor`, `timeOfDay`,
`weatherSeason`, `fantasy`, `characters` (composition — see below),
`characterCount`, `dogPresent`, `otherAnimals`, `transportation`,
`activity`, `emotionalTone`, `keywords`, `ambience` (maps to
`Chapter['ambience']` for backward-compatible matching), and `focal` (a
0–1 fractional point used for `object-position`, so `SceneBackground`'s
`cover` crop keeps the actual subject in frame instead of always cropping
around the image's geometric center).

`characters` values: `solo-boy`, `solo-girl`, `pair-boy-dog`,
`pair-girl-dog`, `boy-girl` (duo, no dog — only the 2 underwater/astronaut
panels from the 4×4 sheet), `trio` (boy+girl+dog), `none`
(background-only). This is a continuity SIGNAL, never a theme filter — the
manifest deliberately does not encode "girls get X, boys get Y."

## Selector — `lib/scene-selector.ts`

`selectSceneForPage(chapter, page, pageIndex, avatar, uid)` — called once
per PAGE (not once per chapter), so a multi-page chapter progresses
through different, thematically-related art instead of freezing on one
image for the whole read. Home calls it once against `chapter.pages[0]`
for its single cover image.

Every asset in the manifest is scored; the highest wins. Weighted, not a
brittle if/else chain:

```
score = 6 × (page-text/focus-word keyword overlap with asset keywords/theme)
      + 2 × (chapter setting/character keyword overlap — story-level continuity)
      + 4   if asset.ambience includes chapter.ambience
      + character-continuity(avatar, asset.characters, dog-bias)
      [tie-break: prefer a NOT-recently-shown asset, only within 3 points of the top score]
```

- **Keyword matching** uses a lightweight prefix-based fuzzy match (exact
  equality, or one word is a ≥4-letter prefix of the other — e.g.
  `"snowy"~"snow"`, `"sledding"~"sled"`) rather than a real stemmer, and
  expands multi-word manifest entries (`"floating castle"`,
  `"hot air balloon"`) into their individual word tokens so a single-word
  query (`"castle"`, `"balloon"`) still matches.
- **Character continuity**: known avatar → +3 for a matching-gender
  solo/pair scene, +2 for a trio (always safe — includes both genders),
  −1 for an opposite-gender solo/pair (a penalty, never an exclusion — a
  uniquely strong semantic match still wins). No avatar chosen yet → no
  gender term applied at all. A small dog-presence bonus applies only when
  `chapter.ambience === 'farm'` (the one ambience the `'dogs'` interest
  maps to in `lib/chapters.ts`'s `SETTINGS`) — not a blanket bias.
- **Recency** is a bounded, per-uid localStorage history (last 4 asset
  ids, same pattern as `lib/pet.ts`/`lib/chapter-history.ts`), applied
  ONLY as a tie-breaker among near-equal scores. A uniquely-best semantic
  match is never displaced for novelty — verified by a dedicated test (see
  below) and observed live: a page whose text carries no distinguishing
  content correctly reuses the chapter's dominant scene rather than
  picking something semantically weaker just to avoid a repeat.
- Every asset gets a score, so the function **never returns null** —
  uncertainty degrades to the closest broadly-compatible scene (often a
  background-only asset, which always scores at least the ambience match),
  never to a forced wrong character/setting. The `.lc-scenic`/`.lc-cliff`
  CSS gradient remains the true last resort, reached only if a chosen
  asset's `<img>` 404s at runtime (`SceneBackground`'s existing `onError`).

## Rendering — `components/SceneBackground.tsx`

One addition: an optional `focal?: {x,y}` prop, applied as inline
`object-position` on the `<img>` only when provided. Every existing caller
that doesn't pass one keeps its exact prior centered-crop behavior — this
is additive, not a rewrite of the component's rendering model. No new
design system, no layout change, no new component tree: the same
full-bleed `<img>` behind the same DOM controls, same CSS animations
(`lc-scene-drift`, the cliff zoom, the listening-pause), same card/button/
control language on top.

## Quarantined legacy assets

`public/images/landing/{dinosaurs,ocean,space,unicorns}-*.jpg` (the OLD
`REAL_SCENE_POOL` in `lib/chapters.ts`, now removed) are landing-page HERO
illustrations, not scene backgrounds: every one has "Today's Chapter" baked
into the art with a character holding an open book, and `dinosaurs-01/02`
both show a BEAR with no dinosaur content at all. Nothing in the new
selector or manifest references them. They were **left on disk, not
deleted** — nothing else in the repo currently uses them, but removing
files is an unforced, unrelated cleanup outside this task's scope. See
`lib/chapters.ts`'s comment block at the old `selectStoryScene` call site
for the full finding.

## Tests

- `scripts/test-scene-system.ts` (Node-runnable, no dev server needed):
  asset integrity (57 manifest paths all resolve to real files, no
  zero-byte/<5KB assets, no composite/contact-sheet path ever appears, no
  orphaned files under `public/images/scenes/`, no stray composite left
  under `public/`), 15 representative semantic-selection scenarios (ocean/
  lighthouse, forest, castle/fantasy, desert, underwater, snow/sledding,
  train, pretend-airplane, sports, baking, nighttime/stars, rainbow,
  dinosaur, plus an explicit "never picks obviously unrelated art" guard),
  and continuity (determinism, avatar-based character continuity in both
  directions, no-avatar-yet safety, weak-signal-still-resolves, semantic
  correctness surviving a forced-repeat scenario).
- Manual Playwright walkthrough (see final report) across 4 profiles ×
  3 breakpoints × 3 pages each + Home + chapter-end — real dev server, real
  `sim: good` page advances, visual inspection of every screenshot plus a
  computed-style check (`getComputedStyle` on the reading card and scene
  `<img>`) to rule out a suspected legibility artifact (traced to a one-off
  screenshot-capture timing issue, not a real rendering bug — reproduced
  the exact same scene 3 times afterward, always fully opaque/legible).
