/* POST /api/progress/complete-session
 *
 * Body: { childId, ageDerivedStageEstimate, sessionInput, interventions,
 *         previouslyTricky? }
 *
 * Re-derives the SessionReading server-side via
 * interpretSessionWithIntervention() — the ONLY interpretation entry point
 * used anywhere in this app — rather than trusting a client-computed
 * verdict for something that can move a child's stage. Idempotent per
 * sessionInput.chapterId: a repeat call (double-tap, retried request) never
 * applies progression twice. See lib/progress-store-admin.ts for the
 * Firestore transaction that makes this true under real concurrency, not
 * just in the common case. */

import { NextRequest, NextResponse } from 'next/server';
import { requireReadingUser, adminUnconfiguredResponse } from '@/lib/route-auth';
import { completeSessionRemotely } from '@/lib/progress-store-admin';
import type { SessionInput } from '@/reading-tutor/src/types';
import type { SessionIntervention } from '@/lib/reading-session-interpreter';

interface Body {
  childId?: string;
  ageDerivedStageEstimate?: number;
  sessionInput?: SessionInput;
  interventions?: SessionIntervention;
  previouslyTricky?: string[];
}

function isWellFormedSessionInput(s: unknown): s is SessionInput {
  if (!s || typeof s !== 'object') return false;
  const r = s as Partial<SessionInput>;
  return (
    typeof r.sessionId === 'string' &&
    typeof r.chapterId === 'string' &&
    typeof r.stage === 'number' &&
    typeof r.startedAt === 'string' &&
    Array.isArray(r.sentences)
  );
}

export async function POST(request: NextRequest) {
  const unconfigured = adminUnconfiguredResponse();
  if (unconfigured) return unconfigured;

  const auth = await requireReadingUser(request);
  if (!auth.ok) return auth.response;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  if (!body.childId || typeof body.childId !== 'string') {
    return NextResponse.json({ error: 'MISSING_CHILD_ID' }, { status: 400 });
  }
  if (!isWellFormedSessionInput(body.sessionInput)) {
    return NextResponse.json({ error: 'MISSING_OR_INVALID_SESSION_INPUT' }, { status: 400 });
  }
  if (!Array.isArray(body.interventions)) {
    return NextResponse.json({ error: 'MISSING_INTERVENTIONS' }, { status: 400 });
  }

  const estimatedStage = Number.isFinite(body.ageDerivedStageEstimate) ? body.ageDerivedStageEstimate! : 1;

  try {
    const result = await completeSessionRemotely(
      auth.uid,
      body.childId,
      estimatedStage,
      body.sessionInput,
      body.interventions,
      Array.isArray(body.previouslyTricky) ? body.previouslyTricky : [],
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error completing session:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
