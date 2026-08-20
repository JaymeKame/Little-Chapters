/* GET /api/progress/child?childId=...&estimatedStage=...
 *
 * Loads this child's ChildProgress, creating one (via reading-tutor's
 * initialStage()) if this is the first time this child has ever been seen
 * server-side. Ownership is the VERIFIED caller uid from requireReadingUser
 * — childId is caller-supplied but only ever partitions data under that
 * caller's own uid, so it carries no cross-account risk (see
 * lib/progress-store-admin.ts). */

import { NextRequest, NextResponse } from 'next/server';
import { requireReadingUser } from '@/lib/route-auth';
import { adminUnconfiguredResponse } from '@/lib/route-auth';
import { loadOrCreateProgress } from '@/lib/progress-store-admin';

export async function GET(request: NextRequest) {
  const unconfigured = adminUnconfiguredResponse();
  if (unconfigured) return unconfigured;

  const auth = await requireReadingUser(request);
  if (!auth.ok) return auth.response;

  const childId = request.nextUrl.searchParams.get('childId');
  if (!childId) {
    return NextResponse.json({ error: 'MISSING_CHILD_ID' }, { status: 400 });
  }
  const estimatedStageRaw = Number(request.nextUrl.searchParams.get('estimatedStage'));
  const estimatedStage = Number.isFinite(estimatedStageRaw) ? estimatedStageRaw : 1;

  try {
    const result = await loadOrCreateProgress(auth.uid, childId, estimatedStage);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error loading child progress:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
