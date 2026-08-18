import { NextRequest, NextResponse } from 'next/server';
import { generateChapter, type LlmClient } from '@/reading-tutor/src/generate';
import { pickSkeleton, SKELETONS } from '@/reading-tutor/src/skeletons';
import { assignSlots } from '@/reading-tutor/src/slots';
import { type ChildProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ error: 'Story generation is not configured' }, { status: 503 });
  try {
    const body = await request.json() as { profile?: ChildProfile; stage?: number; skeletonId?: string };
    const profile = body.profile;
    if (!profile?.childName || !Array.isArray(profile.interests)) {
      return NextResponse.json({ error: 'Invalid profile' }, { status: 400 });
    }
    const stage = Math.min(10, Math.max(1, Math.round(body.stage || 1)));
    const skeleton = SKELETONS.find((candidate) => candidate.id === body.skeletonId) ?? pickSkeleton(stage, []);
    const slots = assignSlots(skeleton.beats, stage);
    const llm: LlmClient = {
      async complete(prompt: string) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: process.env.OPENAI_STORY_MODEL || 'gpt-4o-mini', temperature: 0.4, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
        });
        if (!response.ok) throw new Error(`story model returned ${response.status}`);
        const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        return json.choices?.[0]?.message?.content ?? '';
      },
    };
    const result = await generateChapter({
      stage,
      cast: { childName: profile.childName, petName: profile.childName },
      interests: profile.interests,
      storySoFar: '',
      recentlyMissedWords: [],
      skeleton,
      slots,
    }, llm);
    if (!result.ok || !result.draft) {
      console.error('Tutor story generation exhausted retries', result.rejectionLog);
      return NextResponse.json({ error: 'Story generation failed' }, { status: 503 });
    }
    return NextResponse.json({ draft: result.draft, skeleton });
  } catch (error) {
    console.error('Tutor story generation failed:', error);
    return NextResponse.json({ error: 'Story generation failed' }, { status: 503 });
  }
}