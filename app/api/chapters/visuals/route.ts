import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { adminCredentialsConfigured, adminDb, adminStorage, adminStorageConfigured } from '@/lib/firebase-admin';
import { requireReadingUser } from '@/lib/route-auth';
import type { Chapter } from '@/lib/chapters';
import { buildStoryInteractionManifest } from '@/lib/story-interactions';
import { VISUAL_BIBLE_VERSION, type ChapterScenePackage, type GeneratedSceneAsset, type SceneEntityMetadata } from '@/lib/chapter-scenes';
import { ownedDailyChapter } from '@/lib/chapter-entitlement-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const inFlight = new Map<string, Promise<ChapterScenePackage>>();
const grants = new Map<string, { start: number; count: number }>();

function rateLimited(uid: string): boolean {
  const now = Date.now(); const value = grants.get(uid);
  if (!value || now - value.start > 3_600_000) { grants.set(uid, { start: now, count: 1 }); return false; }
  value.count += 1; return value.count > 5;
}

function packageId(chapterId: string) {
  return createHash('sha256').update(`${chapterId}:v${VISUAL_BIBLE_VERSION}`).digest('hex');
}

function packageRef(chapterId: string) {
  return adminDb().collection('chapterScenePackages').doc(packageId(chapterId));
}

export async function GET(request: NextRequest) {
  const auth = await requireReadingUser(request); if (!auth.ok) return auth.response;
  const chapterId = request.nextUrl.searchParams.get('chapterId');
  if (!chapterId || chapterId.length > 180) return NextResponse.json({ error: 'INVALID_CHAPTER_ID' }, { status: 400 });
  if (!adminCredentialsConfigured()) return NextResponse.json({ error: 'SCENE_PACKAGE_NOT_FOUND' }, { status: 404 });
  if (auth.uid !== 'anonymous' && !(await ownedDailyChapter(auth.uid, chapterId))) return NextResponse.json({ error: 'SCENE_PACKAGE_NOT_FOUND' }, { status: 404 });
  const existing = await packageRef(chapterId).get();
  if (!existing.exists) return NextResponse.json({ error: 'SCENE_PACKAGE_NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ scenePackage: existing.data() as ChapterScenePackage, cache: 'hit' });
}

function validChapter(value: unknown): value is Chapter {
  const chapter = value as Chapter;
  return Boolean(chapter && typeof chapter.id === 'string' && chapter.id.length <= 180 && typeof chapter.character === 'string' && typeof chapter.setting === 'string' && Array.isArray(chapter.pages) && chapter.pages.length >= 3 && chapter.pages.length <= 10 && chapter.pages.every((page) => typeof page?.text === 'string' && page.text.length <= 500));
}

async function generateStoryboard(prompt: string): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('IMAGE_PROVIDER_NOT_CONFIGURED');
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2', prompt, size: '2048x2048', quality: process.env.OPENAI_IMAGE_QUALITY || 'medium', output_format: 'png', n: 1,
    }),
  });
  if (!response.ok) throw new Error(`IMAGE_PROVIDER_${response.status}`);
  const body = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
  const image = body.data?.[0];
  if (image?.b64_json) return Buffer.from(image.b64_json, 'base64');
  if (image?.url) {
    const download = await fetch(image.url); if (!download.ok) throw new Error('IMAGE_DOWNLOAD_FAILED');
    return Buffer.from(await download.arrayBuffer());
  }
  throw new Error('IMAGE_PROVIDER_EMPTY');
}

/** Correction sprint Sections 3-5: reviewer now also returns, per panel,
 *  which requested entities are actually VISIBLE in the rendered image. The
 *  entity metadata attached to each scene is built from that verified set,
 *  never from the prompt alone — so a spatial "find it" interaction can only
 *  target an object the reviewer confirmed. */
interface ReviewedPanel {
  panel: number;
  visibleObjects: Array<{ label: string; confidence: number }>;
  storyBeatRelevance: {
    settingMatches: boolean; characterMatches: boolean; actionMatches: boolean;
    noContradiction: boolean; meaningfullyDifferent: boolean; continuityMatches: boolean;
    confidence: number;
  };
}
interface ReviewOutcome { approved: boolean; reasons: string[]; panels: ReviewedPanel[] }

async function reviewStoryboard(storyboard: Buffer, chapter: Chapter): Promise<ReviewOutcome> {
  const manifest = buildStoryInteractionManifest(chapter);
  const preview = await sharp(storyboard).resize(768, 768, { fit: 'cover' }).jpeg({ quality: 76 }).toBuffer();
  const candidatesByPanel = manifest.scenes.map((scene, index) => {
    const beats = manifest.beats.filter((beat) => beat.visualSceneId === scene.sceneId || beat.interactiveObjects.some((object) => object.visualSceneId === scene.sceneId));
    const candidates = [...new Set([chapter.character, ...beats.flatMap((beat) => beat.storyEntities), ...scene.importantObjects])].filter(Boolean).slice(0, 8);
    return { panel: index + 1, candidates };
  });
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_REVIEW_MODEL || 'gpt-4o-mini', temperature: 0, response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: [
        { type: 'text', text:
          `Review this four-panel children's storybook storyboard for chapter ${chapter.id}. `
          + `Return STRICT JSON with this exact shape:\n`
          + `{"approved": boolean, "reasons": string[], "panels": [{"panel": 1|2|3|4, "visibleObjects": [{"label": "string, must be one of the candidates for that panel", "confidence": 0..1}], "storyBeatRelevance": {"settingMatches": boolean, "characterMatches": boolean, "actionMatches": boolean, "noContradiction": boolean, "meaningfullyDifferent": boolean, "continuityMatches": boolean, "confidence": 0..1}}]}\n`
          + `\nStyle review rules: warm whimsical handcrafted cartoon storybook style; never photorealistic, painterly-realistic, anime, generic/glossy 3D, horror, or glossy AI art; no embedded words/logos; the same characters retain appearance, clothing, proportions and colors in every panel; the environment and palette remain coherent; each panel visibly depicts its requested narrative action; content is calm and child-safe. Set approved=false on any uncertainty.\n`
          + `\nStory-beat relevance is mandatory: compare each panel with its requested panel prompt. settingMatches, required character, approximate action, no contradiction, meaningful change from the prior panel, and continuity must all be true with confidence >=0.7 or approved MUST be false.\n`
          + `\nVisible-objects rules (MANDATORY, even when approved=false): for each of the four panels list ONLY the candidate labels that are UNAMBIGUOUSLY DEPICTED in that panel — a clearly drawn, identifiable object a five-year-old could point to. Never invent labels not in the candidate list. Never list an object because the prompt mentioned it — only because you can SEE it. Confidence is your calibrated certainty (0..1); anything under 0.6 will be treated as unverified downstream, so err on the side of omitting.\n`
          + `\nCandidates per panel (use these labels verbatim):\n`
          + candidatesByPanel.map((row) => `  Panel ${row.panel}: ${row.candidates.join(', ') || '(none)'}`).join('\n'),
        },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${preview.toString('base64')}` } },
      ] }],
    }),
  });
  if (!response.ok) throw new Error(`IMAGE_REVIEW_${response.status}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  let parsed: Partial<ReviewOutcome> = {};
  try { parsed = JSON.parse(body.choices?.[0]?.message?.content ?? '{}') as Partial<ReviewOutcome>; } catch { /* keep empty */ }
  const approved = parsed.approved === true;
  const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.filter((reason): reason is string => typeof reason === 'string') : [];
  const panels: ReviewedPanel[] = Array.isArray(parsed.panels)
    ? parsed.panels
        .filter((row): row is ReviewedPanel => Boolean(row) && typeof row.panel === 'number' && Array.isArray(row.visibleObjects))
        .map((row) => ({
          panel: row.panel,
          visibleObjects: row.visibleObjects
            .filter((item): item is { label: string; confidence: number } => Boolean(item) && typeof item.label === 'string' && typeof item.confidence === 'number')
            .map((item) => ({ label: item.label, confidence: Math.max(0, Math.min(1, item.confidence)) })),
          storyBeatRelevance: {
            settingMatches: row.storyBeatRelevance?.settingMatches === true,
            characterMatches: row.storyBeatRelevance?.characterMatches === true,
            actionMatches: row.storyBeatRelevance?.actionMatches === true,
            noContradiction: row.storyBeatRelevance?.noContradiction === true,
            meaningfullyDifferent: row.storyBeatRelevance?.meaningfullyDifferent === true,
            continuityMatches: row.storyBeatRelevance?.continuityMatches === true,
            confidence: Math.max(0, Math.min(1, row.storyBeatRelevance?.confidence ?? 0)),
          },
        }))
    : [];
  const relevant = panels.length === manifest.scenes.length && panels.every((panel) =>
    Object.entries(panel.storyBeatRelevance).every(([key, value]) => key === 'confidence' ? Number(value) >= 0.7 : value === true));
  if (!approved || !relevant) throw new Error(`IMAGE_REVIEW_REJECTED:${reasons.join('|').slice(0, 400) || 'story-beat relevance failed'}`);
  return { approved, reasons, panels };
}

function storyboardPrompt(chapter: Chapter) {
  const manifest = buildStoryInteractionManifest(chapter);
  const bible = manifest.visualBible;
  return [
    'Create one square 2-by-2 storyboard sheet containing exactly four equally sized panels, no gutters, no captions, no letters, no words, no logos, no watermark.',
    `All four panels are one coherent Little Chapters episode. Style: ${bible.style}. Environment: ${bible.environment}. Palette: ${bible.palette.join(', ')}.`,
    `The protagonist is ${bible.protagonist}${bible.companion ? ` and the companion is ${bible.companion}` : ''}. Lock their appearance, clothing, proportions, colors, and distinguishing features identically in every panel.`,
    `Continuity rules: ${bible.continuityRules.join(' ')} Forbidden: ${bible.forbiddenStyles.join(', ')}, painterly realism, generic 3D, anime, glossy AI art.`,
    ...manifest.scenes.map((scene, index) => `Panel ${index + 1} (${scene.visualPurpose}): ${scene.visualPrompt}`),
    'Each panel must clearly stage its narrative action with a simple child-readable focal point and safe negative space for touch overlays.',
  ].join('\n');
}

/** Build the scene's entity metadata from the VERIFIED-visible subset the
 *  reviewer confirmed for that panel — never from the prompt or beat
 *  manifest alone. Any entity a beat requested but the reviewer did not
 *  confirm is still recorded (verificationConfidence 0, source 'unverified')
 *  so downstream telemetry can see the request-vs-verified delta; the render
 *  path refuses to place a spatial hotspot on anything below 0.6.
 *  Approximate regions are still positional heuristics — precise bounding
 *  boxes are a separate follow-up beyond this correction sprint. */
function entityMetadata(
  chapter: Chapter,
  sceneId: string,
  sceneIndex: number,
  reviewed: ReviewedPanel | undefined,
): SceneEntityMetadata[] {
  const manifest = buildStoryInteractionManifest(chapter);
  const beats = manifest.beats.filter((beat) => beat.visualSceneId === sceneId || beat.interactiveObjects.some((object) => object.visualSceneId === sceneId));
  const requested = [...new Set(beats.flatMap((beat) => beat.storyEntities))];
  const verifiedMap = new Map<string, number>();
  for (const item of reviewed?.visibleObjects ?? []) {
    const key = item.label.toLowerCase();
    // Keep the highest confidence per label.
    verifiedMap.set(key, Math.max(verifiedMap.get(key) ?? 0, item.confidence));
  }
  const regions = [
    { x: 0.08, y: 0.18, width: 0.38, height: 0.64 },
    { x: 0.54, y: 0.18, width: 0.38, height: 0.64 },
    { x: 0.28, y: 0.32, width: 0.44, height: 0.52 },
    { x: 0.10, y: 0.58, width: 0.80, height: 0.32 },
  ];
  // Emit entries for every requested label so downstream telemetry sees the
  // request/verified split, but only labels the reviewer actually named will
  // carry a verificationConfidence at or above the render threshold.
  return requested.slice(0, 4).map((label, index) => {
    const confidence = verifiedMap.get(label.toLowerCase()) ?? 0;
    return {
      entityId: `${sceneId}-entity-${index + 1}`,
      label,
      semanticRole: label.toLowerCase() === chapter.character.toLowerCase()
        ? 'character' as const
        : beats.some((beat) => beat.correctTarget === label)
          ? 'literacy-target' as const
          : 'story-object' as const,
      interactionBeatIds: beats.filter((beat) => beat.storyEntities.includes(label)).map((beat) => beat.beatId),
      approximateRegion: regions[index] ?? regions[0],
      verificationConfidence: confidence,
      verificationSource: confidence > 0 ? 'reviewer' as const : 'unverified' as const,
    };
  });
}

async function uploadScene(bucketName: string, path: string, bytes: Buffer): Promise<string> {
  const token = randomUUID(); const bucket = adminStorage().bucket(bucketName); const file = bucket.file(path);
  await file.save(bytes, { resumable: false, contentType: 'image/webp', metadata: { cacheControl: 'public,max-age=31536000,immutable', metadata: { firebaseStorageDownloadTokens: token } } });
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

async function generatePackage(chapter: Chapter): Promise<ChapterScenePackage> {
  const started = Date.now(); const manifest = buildStoryInteractionManifest(chapter);
  const storyboard = await generateStoryboard(storyboardPrompt(chapter));
  const review = await reviewStoryboard(storyboard, chapter);
  const normalized = await sharp(storyboard).resize(2048, 2048, { fit: 'cover' }).png().toBuffer();
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!;
  const safe = packageId(chapter.id);
  const positions = [{ left:0,top:0 },{ left:1024,top:0 },{ left:0,top:1024 },{ left:1024,top:1024 }];
  const scenes: GeneratedSceneAsset[] = [];
  for (let index = 0; index < manifest.scenes.length; index += 1) {
    const scene = manifest.scenes[index]; const position = positions[index];
    const bytes = await sharp(normalized).extract({ ...position, width:1024, height:1024 }).webp({ quality: 88 }).toBuffer();
    const path = `chapter-scenes/${safe}/v${VISUAL_BIBLE_VERSION}/${scene.sceneId}.webp`;
    const reviewedPanel = review.panels.find((row) => row.panel === index + 1);
    scenes.push({
      sceneId: scene.sceneId,
      assetUrl: await uploadScene(bucketName, path, bytes),
      visualPurpose: scene.visualPurpose,
      entities: entityMetadata(chapter, scene.sceneId, index, reviewedPanel),
    });
  }
  return { chapterId: chapter.id, visualBibleVersion: VISUAL_BIBLE_VERSION, provider: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2', generatedAt: new Date().toISOString(), generationLatencyMs: Date.now() - started, scenes };
}

export async function POST(request: NextRequest) {
  const auth = await requireReadingUser(request); if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { chapter?: unknown } | null;
  if (!validChapter(body?.chapter)) return NextResponse.json({ error: 'INVALID_CHAPTER' }, { status: 400 });
  if (!adminCredentialsConfigured()) return NextResponse.json({ error: 'SCENE_GENERATION_NOT_CONFIGURED' }, { status: 503 });
  const chapter = body.chapter; const id = packageId(chapter.id); const ref = packageRef(chapter.id);
  if (auth.uid !== 'anonymous' && !(await ownedDailyChapter(auth.uid, chapter.id))) return NextResponse.json({ error: 'CHAPTER_NOT_FOUND' }, { status: 404 });
  const existing = await ref.get();
  if (existing.exists) return NextResponse.json({ scenePackage: existing.data() as ChapterScenePackage, cache: 'hit' });
  if (!process.env.OPENAI_API_KEY || !adminStorageConfigured()) return NextResponse.json({ error: 'SCENE_GENERATION_NOT_CONFIGURED' }, { status: 503 });
  if (rateLimited(auth.uid)) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  let pending = inFlight.get(id);
  if (!pending) { pending = generatePackage(chapter); inFlight.set(id, pending); pending.finally(() => inFlight.delete(id)).catch(() => undefined); }
  try {
    const scenePackage = await pending; await ref.set(scenePackage);
    return NextResponse.json({ scenePackage, cache: 'miss' });
  } catch (error) {
    console.error('Chapter scene generation failed', error);
    return NextResponse.json({ error: 'SCENE_GENERATION_FAILED' }, { status: 503 });
  }
}
