# Scene Progression Regression Audit

Audit date: 2026-08-25. Baseline: `claude/commercial-experience-correction-ux9fr1` at `346766707d25a82671d4781dd76de1d3a8a5781b`.

This is an evidence-only handoff. It changes no runtime behavior and does not claim that the defect is fixed.

## 1. Verified starting SHA

The audit branch was cut directly from `346766707d25a82671d4781dd76de1d3a8a5781b` after fetching `claude/commercial-experience-correction-ux9fr1`. `git rev-parse HEAD` returned the requested full SHA before this report was added. The remote branch had subsequently advanced to `6885555`; that later commit was deliberately not used.

## 2. Exact live render path

1. `/read` obtains a `Chapter` and memoizes `resolveStoryInteractionManifest(chapter)`.
2. `resolveStoryInteractionManifest` accepts only manifest version 2 for the same `chapter.id`, otherwise rebuilds it. `sceneGroups(5)` creates four authored scenes: page groups `[0,1]`, `[2]`, `[3]`, `[4]`.
3. The read effect clears `scenePackage`, checks `little-chapters-scene-package:<chapterId>:v2`, then performs an authenticated durable GET and only POSTs when GET proves absence.
4. The server creates one 2048-square storyboard, reviews it, normalizes it to 2048×2048, extracts four 1024×1024 panels, uploads each, and persists the `ChapterScenePackage`.
5. `sceneAssetUrls` maps every manifest scene ID to its package URL, or independently selects a static fallback for that scene's first page.
6. `sceneSelection` independently selects approved static art for the current `pageIdx`.
7. **The actual background request ignores the active interaction:** `currentSceneId` is found only from the manifest scene whose `pageIndexes` contains `pageIdx`; `sceneBg` is that package URL or the current page's static selection.
8. Every reading, correction, interaction, unlock and ending branch passes the same `sceneBg` to `SceneBackground`.
9. `SceneBackground` renders `<img src={src}>` without rewriting the URL. Its only state is `failed`; that state resets whenever `src` changes and removes the image after an error.
10. Prediction is the one partial exception: each option-card `<img>` reads `sceneAssetUrls[choice.visualSceneId]`, but the full-screen background still uses page-owned `sceneBg`.

### Representative five-page decision trace

The following is the deterministic trace for the baseline's five-page manifest. “DOM src” follows directly from `SceneBackground`'s transparent prop-to-`img` implementation. URL identity for a real generated package cannot be filled without the persisted package or authenticated live session (see §18).

| pageIdx | phase/state | active interaction | kind | authored page scene | interaction `visualSceneId` | selected background scene | selected URL / `SceneBackground` prop / DOM `<img src>` | changed from previous state? |
|---:|---|---|---|---|---|---|---|---|
| 0 | reading | — | — | scene-1 | — | scene-1 | `sceneUrl(package,scene-1) ?? static(page 0)` | package-dependent |
| 0 or 1 | interaction | find-sound | sound-hunt | scene-1 | scene-1 | scene-1 | page-owned scene-1 URL | no if entered after scene-1 page |
| 1 or 2 | interaction | find-in-scene | find-in-scene | scene-1 or scene-2 | scene-2 | **page scene, not interaction scene** | page-owned URL | only if page grouping changed |
| 2 or 3 | interaction | prediction | prediction | scene-2 or scene-3 | scene-3 | **page scene, not interaction scene** | page-owned URL; cards request scene-2 and scene-3 | background: only page-dependent |
| 3 | interaction | word-builder | word-builder | scene-3 | scene-3 | scene-3 | page-owned scene-3 URL | no |
| 4 | ready | final-unlock activity is not `activeInteraction` | final-story-unlock | scene-4 | scene-4 | scene-4 | page-owned scene-4 URL | package-dependent |
| 4 | chapter-end | — | ending | scene-4 | — | scene-4 | same page-owned scene-4 URL | no |

The exact active-interaction `afterPage` is session-composition dependent, but that does not alter the defect: active interaction state is never an input to background selection.

## 3. Exact collapse points

There are two distinct collapse surfaces.

* **Confirmed renderer collapse:** authored `activeInteraction.activity.visualSceneId` reaches lookahead/preload, grounding lookup and Prediction card lookup, but never background ownership. `sceneBg` uses only `pageIdx`. When interaction and page scene IDs differ, `SceneBackground` receives the page scene.
* **Observed page-asset collapse, upstream of `SceneBackground`:** physical testing establishes that the resolved visible asset does not change across reading pages. The component cannot create this repetition: it emits exactly its changing prop and resets failure state on prop changes. Therefore the repeated reading image must already be the same resolved URL/bytes before the component, either in the persisted package or static fallback selection. The checked-out repository contains neither the physically tested browser's localStorage/Firestore package nor its authenticated storage data, so this audit cannot honestly distinguish same URL from byte-identical different URLs.

## 4. Case classification

**F (more than one failure), with the evidence boundary made explicit.** Case **C** is proven for interactions: even distinct valid interaction assets are not selected as the full-screen render. The reading-page repetition is a second, upstream asset-resolution/package/fallback failure established by the authoritative physical observation, but its A-versus-B-versus-D/E subtype is not provable from this checkout because the real package is unavailable. No source evidence supports E: lookups use exact scene IDs and cache keys include chapter, scene and URL. D is rejected for locally accepted packages because the loader requires at least three scenes, although malformed server records are not revalidated on GET.

## 5. Do reading and interaction repetition share one root cause?

**No.** Interaction repetition has a renderer ownership bug even when the package contains four distinct assets. Reading-page repetition cannot be caused by that interaction bug because reading does use the page-authored scene ID. It requires repeated URL/bytes from the package or fallback resolution. The physical symptom is shared; the causal stages are not.

## 6. Generated package scene ID → URL → hash table

No real package was committed, cached in this workspace, or retrievable anonymously. The route requires reading auth, and storage paths/tokens exist only inside the persisted package. Consequently fabricated hashes would be misleading.

| sceneId | assetUrl | expected storage path | bytes | SHA-256 | visualPurpose | pageIndexes | interactionBeatIds |
|---|---|---|---:|---|---|---|---|
| scene-1 | unavailable | `chapter-scenes/<sha256(chapterId:v2)>/v2/scene-1.webp` | unavailable | unavailable | opening | `[0,1]` | find-sound (for a five-page manifest) |
| scene-2 | unavailable | `chapter-scenes/<sha256(chapterId:v2)>/v2/scene-2.webp` | unavailable | unavailable | discovery | `[2]` | find-in-scene |
| scene-3 | unavailable | `chapter-scenes/<sha256(chapterId:v2)>/v2/scene-3.webp` | unavailable | unavailable | choice | `[3]` | prediction, word-builder |
| scene-4 | unavailable | `chapter-scenes/<sha256(chapterId:v2)>/v2/scene-4.webp` | unavailable | unavailable | payoff | `[4]` | final-unlock |

`pageIndexes` and beat association above are reproducible manifest outputs, not claims about the missing persisted record. `GeneratedSceneAsset` itself does not persist storage path, byte length, content hash, page indexes, or interaction IDs; only scene ID, URL, purpose and entity metadata are stored.

## 7. Storyboard cropping

**The implemented geometry is internally correct for the requested layout, but the real output was not available for visual validation.** The provider is asked for `2048x2048` and “exactly four equally sized” 2×2 panels. Sharp normalizes with `resize(2048,2048,{fit:'cover'})`, then crops:

| panel | left | top | width | height |
|---:|---:|---:|---:|---:|
| 1 | 0 | 0 | 1024 | 1024 |
| 2 | 1024 | 0 | 1024 | 1024 |
| 3 | 0 | 1024 | 1024 | 1024 |
| 4 | 1024 | 1024 | 1024 | 1024 |

Those rectangles do not overlap and cannot mechanically extract one quadrant four times. Normalizing a square to a square does not itself destroy boundaries. However, code cannot guarantee that the provider obeyed the 2×2 request: if it returned one full-frame composition or misplaced/unequal panels, these mathematically correct crops would still produce semantically wrong or similar assets. The reviewer sees the whole normalized storyboard but does not verify panel-boundary geometry or cross-panel perceptual uniqueness. A stored storyboard is not retained, so post-hoc comparison is impossible from persistence alone.

## 8. Interaction rendering and `activeInteraction.activity.visualSceneId`

* **Find the Sound:** its authored scene is normally scene-1; background remains the current page's scene. Apparent correctness is incidental when both are scene-1.
* **Find in Scene:** grounding correctly searches package metadata by the interaction scene and requires reviewer confidence ≥0.6, but both spatial and tactile renders pass page-owned `sceneBg`. Thus metadata and visible background can refer to different scenes.
* **Prediction:** activity scene is ignored by the background; option objects separately request their own scene IDs.
* **Word Builder:** background is page-owned. It often equals the authored scene for the normal five-page placement, again incidentally rather than by contract.
* **Final unlock / ending:** final unlock is spoken from the manifest but is not installed as `activeInteraction`; the last page happens to map to scene-4. Ending reuses the same last-page scene.

The preload path using `lookaheadBeat.visualSceneId` does not control render state; it only warms an `Image`.

## 9. Prediction visual finding

For four scenes, the two authored options use **scene-2 and scene-3**, so their scene IDs differ. They resolve through `sceneAssetUrls`; if package/fallback assets differ, the option-card `<img>` URLs differ and are actually used. They are not merely promised in metadata and are not absent. Both cards still sit over one shared page-owned full-screen background. If the map has duplicate URLs/bytes, the same picture appears twice; the current code has no duplicate detection or alternate visual fallback. Physical evidence says the options were not visibly distinct, but the missing live package prevents deciding whether its two URLs were equal or byte-identical.

## 10. Historical regression point

* `1d7918c` (merged as `18411a3`) introduced `sceneSelection = useMemo(selectSceneForPage(...pageIdx...), [chapter,pageIdx,avatar,uid])`; `sceneBg` directly used that per-page result. This was the mechanism that made visible art progress.
* `46c37c6` added generated scene packages and overlaid `currentSceneId → sceneUrl(package,currentSceneId) ?? sceneSelection`. It also introduced interaction scene IDs, lookahead, caches and storyboard cropping. This is the exact commit where generated URL resolution took precedence and where background selection remained page-only despite interaction-authored scene IDs.
* `c8c7315` added the current richer interaction renders and Prediction option images but retained page-owned background selection.
* `3467667` added verified-object grounding and other experience corrections; blame shows it did **not** author the decisive `currentSceneId`/`sceneBg` lines. It preserved the pre-existing renderer ownership gap.

Therefore the first regression-capable commit is `46c37c6`; the interaction/background mismatch persisted through `c8c7315` and `3467667`. The missing package prevents attributing the reading asset-identity problem to a more precise generation event.

## 11. Cache and memo findings

Concrete findings:

* Interaction manifest cache is chapter-keyed and validates version 2 plus chapter ID. It can retain stale v2 content if chapter content changes without changing the ID; it does not hash chapter content.
* Package cache is chapter-keyed and visual-bible-version-keyed and validates chapter ID, version and at least three scenes. It does **not** validate unique scene IDs, unique URLs, expected scene coverage, URL validity or hashes.
* Firestore identity is SHA-256 of `chapterId:v2`; it likewise does not incorporate chapter content. A corrected/re-generated chapter reusing an ID and v2 can inherit an old package indefinitely.
* Server GET and the existing-package POST fast path cast persisted data without schema validation. A malformed package can therefore bypass the stricter local loader and then be saved locally.
* `sceneAssetUrls` dependencies include chapter, manifest, package, avatar and uid; no missing dependency or stale map was found.
* `sceneSelection` dependencies include chapter, page index, avatar and uid; no stale page closure was found.
* `currentSceneId` is recomputed each render; it is not memoized or cached incorrectly.
* Scene-package chapter change clears state before lookup and cancels the superseded promise. A brief fallback frame can occur, but stale package is not deliberately carried into the new chapter.
* `SceneBackground.failed` resets on `src`; it does not pin the first successful image. If the new source fails, it shows the CSS backdrop rather than reusing the old image.
* Preload cache keys include `chapterId:sceneId:url`, so there is no scene-ID or chapter collision. Persisted “ready” state only affects telemetry; a new `Image` is still assigned the URL.
* Lookahead dependencies are complete for its inputs and it has no render ownership.
* The concrete design gap is lack of asset-identity validation and lack of interaction ownership, not a proven React memo/cache defect.

## 12. Why existing tests missed the bug

| test | what it checks | actual DOM `<img src>`? | visual asset identity? |
|---|---|---:|---:|
| `scripts/test-scene-system.ts` | approved static manifest files, IDs, selector determinism/semantics | no | static file existence/uniqueness only |
| `scripts/test-chapter-scene-generation.ts` | manifest/package shape, fabricated distinct URLs, cache GET/POST behavior, regex presence of current page scene resolution | no | no; it assumes distinct mock URLs |
| `scripts/test-daily-adventure.ts` | chapter/session/debug metadata and counters | no | no |
| `scripts/test-experience-correction.ts` | grounding fields/gate by source regex plus interaction mechanics | no | no |
| `scripts/test-experience-sprint.ts` | UX/source contracts | no | no |
| `scripts/capture-daily-adventure.ts` | responsive bounds and screenshots | it renders one, but never records/asserts it | no; chapter and visuals APIs are forced to 503, each state opens a fresh page, and screenshots are not compared |

The key false-positive is the chapter-scene test's regex assertion that `/read` contains `sceneUrl(scenePackage,currentSceneId)`. That proves wiring text exists, not that successive DOM images or bytes differ. Captures explicitly test fallback, isolate states in new contexts, and make no cross-state pixel/hash assertion.

## 13. Minimum browser regression test required

One Playwright context, one deterministic five-page chapter, and one deterministic package whose four same-origin fixture images have known distinct SHA-256 hashes. Keep the same page alive and drive the real session transitions. At each state capture: page index, phase, active beat, requested scene ID, `.lc-scene-bg img` `getAttribute('src')`, resolved `currentSrc`, downloaded bytes/hash, and Prediction option image sources/hashes.

Required assertions:

1. page 0 DOM/currentSrc/hash = A;
2. later reading page = B and differs from A;
3. an interaction whose authored scene differs from its current page receives the interaction asset in the background;
4. Prediction options resolve to two intended, visually distinct hashes (or explicitly authored distinct fallbacks);
5. last reading/unlock = payoff asset D;
6. ending intentionally retains D;
7. none of scene-1…scene-4 URLs or hashes are duplicates unless explicitly authored.

This is the minimum because URL inequality alone cannot catch case B, and screenshots without state-to-state assertions cannot catch any progression regression.

## 14. Required `window.__chapterDebug()` additions

Current debug exposes chapter/provenance IDs, package ID, visual source, a scene-ID/URL list, fallback/failure reasons, voice provider and session timing. It omits render state entirely.

Add, only in development: `pageIdx`, phase, active interaction ID/kind, active interaction `visualSceneId`, page-authored scene ID, requested/effective scene ID, resolved scene URL, actual `.lc-scene-bg img` attribute/currentSrc, scene-ID→URL map, per-entry generated/static source, duplicate URL groups, package `visualBibleVersion`, and package provenance (`localStorage`, server cache hit, generation miss, static fallback). Do not include auth tokens, Firebase download-token decomposition, prompts, child PII, or provider keys. “Actual DOM” should be read when the snapshot is called rather than copied into React state.

## 15. Claude work that must be preserved

Treat as authoritative: interaction manifest v2; visual bible v2; reviewer-produced `visibleObjects`; `verificationConfidence` and `verificationSource`; the ≥0.6 gate; tactile fallback when unverified; scene-specific entity metadata; durable Firestore/Storage persistence; composed session mechanics; current `StoryInteractionBeat` scene IDs; and the one-beat preload/lookahead architecture. The progression bug is independent of confidence gating. Do not roll back `VISUAL_BIBLE_VERSION = 2` or restore prompt-inferred hotspots.

A future background-ownership change must ensure Find in Scene's displayed scene is the same scene whose verified entity metadata is used. That aligns with, rather than conflicts with, Claude's grounding contract.

## 16. Exact implementation-pass touch set

Smallest expected production touch:

* `app/read/page.tsx`: replace the page-only effective scene decision with an explicit requested scene ID that prefers `activeInteraction.activity.visualSceneId`, while retaining page scene behavior outside interactions; use the same effective URL/focal/provenance consistently in all `SceneBackground` branches.
* `lib/adventure-debug.ts` and the `/read` debug installation call: add the minimal render provenance in §14.
* A new focused Playwright regression test (or a narrowly extended browser test) plus four deterministic fixture assets.

Only if the live-package hash capture proves duplicate assets: narrowly extend `app/api/chapters/visuals/route.ts` package validation/review to reject duplicate panel hashes or malformed coverage, and version/invalidate affected packages deliberately while retaining v2 entity semantics. Do not make this speculative server change before obtaining the package.

## 17. Files/functions the implementation pass should not touch

Do not touch auth (`components/AuthProvider.tsx`, route auth), payments/entitlement, audio/TTS/pronunciation/grading/help ladder, chapter persistence/history/progress, routing/navigation, parent/setup UX, provider choice/model architecture, `lib/scene-manifest.ts` approval architecture, visual-bible schema/version, `buildStoryInteractionManifest` beat authoring, session composition/mechanics, Firestore/Storage durability, or the reviewer confidence/tactile-fallback contract. `components/SceneBackground.tsx` needs no behavioral change: it already tracks `src` correctly.

## 18. Provider/live-data limitation

This checkout had no `.env.local`, Firebase service account, Firebase web configuration, OpenAI key, authenticated browser state, localStorage package, Firestore export, stored original storyboard, or persisted asset URLs. The production `/api/chapters/visuals` route is intentionally auth-gated. The public deployment found in repository test fixtures did not expose the needed package anonymously and is not evidence that it runs SHA `3467667`. Thus direct remote URL download, byte length/hash comparison, storage metadata inspection and real storyboard/crop inspection were not feasible. This limitation is why §6 reports unavailable values rather than invented evidence.

The next diagnostic run needs either (a) an exported redacted `ChapterScenePackage` from the physically failing session plus temporary read access to its four URLs, or (b) an authenticated browser session against the exact baseline deployment. Hash all four responses immediately and retain the storyboard for boundary inspection.

## 19. Smallest safe fix recommendation

First obtain the missing package/hash evidence. Independently of that outcome, make the surgical renderer correction: compute one effective requested scene ID—interaction-authored while an interaction is active, otherwise page-authored—and resolve/present that one ID everywhere the full-screen background is rendered. Keep lookahead preload-only and preserve all grounding/session architecture. Add the browser test in §13.

If and only if hashes prove upstream duplication, add the smallest package acceptance guard (expected scene coverage + unique content hashes) and regenerate only affected chapter/version records. Do not change provider, storyboard architecture, visual bible v2, or static approval rules. The bug remains unfixed in this audit.
