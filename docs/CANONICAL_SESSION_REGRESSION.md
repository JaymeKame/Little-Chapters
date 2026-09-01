# Canonical reader startup and generated-art regression

## Historical path

The last likely working generated-art implementation is PR #26 at
`65db8e52e5d1bb72b10fa3914f406189c3a68eba` ("Generate durable chapter
scene packages"). Its reader posted whichever client chapter was mounted to
`/api/chapters/visuals`; the route generated or returned a package without a
canonical daily-chapter ownership check. PR #27 (`f95f6919...`) added durable
GET-before-POST hydration but retained that permissive POST sequence.

Commit `2146b2c883c640564f6741089e7b6456e1e18446` introduced the correct
`ownedDailyChapter` authorization requirement. The reader still immediately
mounted `chapterFor(todayLocal())`, allowed reading, discarded a later server
result after `startedReadingRef` became true, and independently started the
visual effect for the mounted placeholder. That combination made secure image
generation return `CHAPTER_NOT_FOUND` for a chapter the server had never made
canonical. The safety check was correct; the reader ownership sequence was not.

## Repaired sequence

Read now has one owner and one order:

1. settle profile and authentication;
2. show the existing child-safe preparation state with no interactive chapter;
3. resolve the server-generated or server-owned fallback chapter;
4. bind active, story-request, canonical, and visual-request IDs together;
5. enable reading only when those IDs match and ownership is ready;
6. request generated art for that exact chapter.

The active chapter alone owns story provenance. Module-global request telemetry
is exposed separately as `lastStoryRequestDiagnostic` and cannot supply the
active chapter's source or failure reason.
