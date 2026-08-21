import { NextResponse, type NextRequest } from 'next/server';
import type { ReadingDebugPayload, ReadingGradingMode } from '@/lib/reading-debug';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 32 * 1024;
const MAX_WORDS = 200;
const MODES: ReadingGradingMode[] = ['azure+mdd', 'azure-only'];
const REASONS = ['omitted', 'both-graders', 'azure-only-fallback', null];

function isNullableScore(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isPayload(value: unknown): value is ReadingDebugPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<ReadingDebugPayload>;
  if (!payload.gradingMode || !MODES.includes(payload.gradingMode)) return false;
  if (!Array.isArray(payload.words) || payload.words.length > MAX_WORDS) return false;
  return payload.words.every((word) =>
    word !== null
    && typeof word === 'object'
    && typeof word.word === 'string'
    && word.word.length <= 100
    && typeof word.needsHelp === 'boolean'
    && REASONS.includes(word.reason)
    && isNullableScore(word.azureAccuracy)
    && isNullableScore(word.azureMinPhoneme)
    && isNullableScore(word.decodeScore)
    && word.graders === payload.gradingMode
  );
}

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get('debugReading') !== '1') {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
  }
  const payload: unknown = await req.json().catch(() => null);
  if (!isPayload(payload)) {
    return NextResponse.json({ error: 'BAD_DEBUG_PAYLOAD' }, { status: 400 });
  }
  return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
}
