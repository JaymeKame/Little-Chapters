import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { adminDb, adminStorage, adminStorageConfigured } from '@/lib/firebase-admin';
import { requireReadingUser } from '@/lib/route-auth';
import type { Chapter } from '@/lib/chapters';
import { buildStoryInteractionManifest } from '@/lib/story-interactions';
import { VISUAL_BIBLE_VERSION, type ChapterScenePackage, type GeneratedSceneAsset, type SceneEntityMetadata } from '@/lib/chapter-scenes';

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

async function reviewStoryboard(storyboard: Buffer, chapter: Chapter): Promise<void> {
  const preview = await sharp(storyboard).resize(768, 768, { fit: 'cover' }).jpeg({ quality: 76 }).toBuffer();
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_REVIEW_MODEL || 'gpt-4o-mini', temperature: 0, response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: [
        { type: 'text', text: `Review this four-panel children's storybook storyboard for chapter ${chapter.id}. Return JSON {"approved":boolean,"reasons":string[]}. Approve only if: warm whimsical handcrafted cartoon storybook style; never photorealistic, painterly-realistic, anime, generic/glossy 3D, horror, or glossy AI art; no embedded words/logos; the same characters retain appearance, clothing, proportions and colors in every panel; the environment and palette remain coherent; each panel visibly depicts its requested narrative action; content is calm and child-safe. Reject on any uncertainty.` },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${preview.toString('base64')}` } },
      ] }],
    }),
  });
  if (!response.ok) throw new Error(`IMAGE_REVIEW_${response.status}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const verdict = JSON.parse(body.choices?.[0]?.message?.content ?? '{}') as { approved?: boolean; reasons?: string[] };
  if (verdict.approved !== true) throw new Error(`IMAGE_REVIEW_REJECTED:${(verdict.reasons ?? []).join('|').slice(0, 400)}`);
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

function entityMetadata(chapter: Chapter, sceneId: string): SceneEntityMetadata[] {
  const manifest = buildStoryInteractionManifest(chapter);
  const beats = manifest.beats.filter((beat) => beat.visualSceneId === sceneId || beat.interactiveObjects.some((object) => object.visualSceneId === sceneId));
  const labels = [...new Set(beats.flatMap((beat) => beat.storyEntities))].slice(0, 4);
  const regions = [{ x:.08,y:.18,width:.38,height:.64 },{ x:.54,y:.18,width:.38,height:.64 },{ x:.28,y:.32,width:.44,height:.52 },{ x:.1,y:.58,width:.8,height:.32 }];
  return labels.map((label, index) => ({
    entityId: `${sceneId}-entity-${index + 1}`, label,
    semanticRole: label.toLowerCase() === chapter.character.toLowerCase() ? 'character' : beats.some((beat) => beat.correctTarget === label) ? 'literacy-target' : 'story-object',
    interactionBeatIds: beats.filter((beat) => beat.storyEntities.includes(label)).map((beat) => beat.beatId),
    approximateRegion: regions[index],
  }));
}

async function uploadScene(bucketName: string, path: string, bytes: Buffer): Promise<string> {
  const token = randomUUID(); const bucket = adminStorage().bucket(bucketName); const file = bucket.file(path);
  await file.save(bytes, { resumable: false, contentType: 'image/webp', metadata: { cacheControl: 'public,max-age=31536000,immutable', metadata: { firebaseStorageDownloadTokens: token } } });
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

async function generatePackage(chapter: Chapter): Promise<ChapterScenePackage> {
  const started = Date.now(); const manifest = buildStoryInteractionManifest(chapter);
  const storyboard = await generateStoryboard(storyboardPrompt(chapter));
  await reviewStoryboard(storyboard, chapter);
  const normalized = await sharp(storyboard).resize(2048, 2048, { fit: 'cover' }).png().toBuffer();
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!;
  const safe = packageId(chapter.id);
  const positions = [{ left:0,top:0 },{ left:1024,top:0 },{ left:0,top:1024 },{ left:1024,top:1024 }];
  const scenes: GeneratedSceneAsset[] = [];
  for (let index = 0; index < manifest.scenes.length; index += 1) {
    const scene = manifest.scenes[index]; const position = positions[index];
    const bytes = await sharp(normalized).extract({ ...position, width:1024, height:1024 }).webp({ quality: 88 }).toBuffer();
    const path = `chapter-scenes/${safe}/v${VISUAL_BIBLE_VERSION}/${scene.sceneId}.webp`;
    scenes.push({ sceneId: scene.sceneId, assetUrl: await uploadScene(bucketName, path, bytes), visualPurpose: scene.visualPurpose, entities: entityMetadata(chapter, scene.sceneId) });
  }
  return { chapterId: chapter.id, visualBibleVersion: VISUAL_BIBLE_VERSION, provider: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2', generatedAt: new Date().toISOString(), generationLatencyMs: Date.now() - started, scenes };
}

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY || !adminStorageConfigured()) return NextResponse.json({ error: 'SCENE_GENERATION_NOT_CONFIGURED' }, { status: 503 });
  const auth = await requireReadingUser(request); if (!auth.ok) return auth.response;
  if (rateLimited(auth.uid)) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  const body = await request.json().catch(() => null) as { chapter?: unknown } | null;
  if (!validChapter(body?.chapter)) return NextResponse.json({ error: 'INVALID_CHAPTER' }, { status: 400 });
  const chapter = body.chapter; const id = packageId(chapter.id); const ref = adminDb().collection('chapterScenePackages').doc(id);
  const existing = await ref.get();
  if (existing.exists) return NextResponse.json({ scenePackage: existing.data() as ChapterScenePackage, cache: 'hit' });
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
