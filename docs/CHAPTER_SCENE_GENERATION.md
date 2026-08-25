# Production chapter-scene generation

## Provider decision

The production adapter uses OpenAI Images (`gpt-image-2` by default) and Firebase Storage.

| Option | Continuity/style control | Latency/reliability | Stack impact | Decision |
|---|---|---|---|---|
| OpenAI Images | Strong prompt adherence; a single 2×2 storyboard request keeps the cast, palette, and environment in one generation context | One paid generation per chapter rather than four independent requests | Reuses the existing server-side `OPENAI_API_KEY` and Firebase Admin deployment | Selected |
| Vertex AI Imagen | Strong image tooling and useful subject/style controls | Production-grade, but would add a second model credential/IAM surface | Requires a new Vertex integration and project configuration | Not selected for the smallest sprint |
| Stability API | Broad style controls and competitive cost options | Another external availability and billing dependency | Adds a new vendor SDK/key and does not remove the durable-storage requirement | Not selected |

Commercial rights remain governed by the selected provider account terms. The application stores provider/model metadata with every scene package for auditability and future migration.

## Continuity strategy

Little Chapters asks the provider for one square four-panel storyboard, not four unrelated images. The prompt includes the chapter visual bible once, locks cast/environment/clothing/palette across all panels, gives every panel a narrative purpose, and forbids photorealistic, painterly-realistic, generic 3D, anime, glossy AI imagery, embedded text, and character redesign. The server then crops the storyboard into four immutable WebP scenes. This yields 3–5 scene architecture (currently four for normal chapters) at one generation charge and with stronger within-chapter continuity.

## Persistence and idempotency

The durable identity is `SHA-256(chapterId + visualBibleVersion)`. Before calling the provider, the route reads `chapterScenePackages/{identity}` in Firestore. A hit returns the stored package and URLs. A miss is deduplicated in-process, generated once, cropped, uploaded to Firebase Storage under `chapter-scenes/{identity}/v{version}/{sceneId}.webp`, and then recorded in Firestore. Assets use immutable one-year cache headers. Browser storage is only a local accelerator; Firestore and Storage are authoritative.

## Interaction regions

Current playable primitives use separate word objects and scene-choice cards, so correctness never depends on an image model inventing reliable bounding boxes. Scene metadata records broad normalized regions for semantic entities as progressive-enhancement hints. A future Find It in the Scene renderer may use reviewed regions, but must retain a card/overlay fallback when region confidence is unavailable.

## Failure behavior

Missing configuration, provider failure, storage failure, or timeout returns a non-success response. Home resolves that attempt before enabling Play and uses the approved static scene selector. Read continues to use that same approved fallback. Quarantined images are never candidates.

## Required deployment configuration

- `OPENAI_API_KEY`
- `OPENAI_IMAGE_MODEL` (default `gpt-image-2`)
- `OPENAI_IMAGE_QUALITY` (default `medium`)
- `FIREBASE_SERVICE_ACCOUNT` or application credentials
- `FIREBASE_STORAGE_BUCKET`

Physical mobile verification and live provider visual review are release gates; mock/unit results alone are not sufficient approval for generated art.
