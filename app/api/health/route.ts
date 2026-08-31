/* GET /api/health — capability visibility WITHOUT leaking credentials.
 *
 * Reports which providers are CONFIGURED (env vars present) and, for a
 * handful that are cheap to probe, whether they are REACHABLE. Deliberately
 * separate booleans: "configured" means the operator set the key;
 * "reachable" means we actually got a response from the provider on this
 * request. A missing "reachable" field means we did not probe.
 *
 * Never returns keys, tokens, project ids in URLs with credentials, customer
 * emails, or anything else that would help a caller who found this endpoint.
 * The route is intentionally public: the only information it hands out is
 * whether the operator has wired the product up, not who is using it.
 *
 * We do NOT probe every provider on every request — a Stripe or OpenAI call
 * per healthcheck would be expensive and add latency. Only MDD gets a live
 * reachability probe here, because its own /healthz endpoint is free and its
 * cold-start is the single most common source of "app feels slow" complaints.
 */

import { NextResponse } from 'next/server';
import { adminCredentialsConfigured, adminStorageConfigured } from '@/lib/firebase-admin';
import { LITTLE_CHAPTERS_BUILD } from '@/lib/build-info';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Capability {
  configured: boolean;
  /** Only present when the route actually tried to talk to the provider. */
  reachable?: boolean;
}

function configured(...envVars: string[]): boolean {
  return envVars.every((name) => Boolean(process.env[name]?.trim()));
}

async function probeMdd(): Promise<boolean> {
  const url = (process.env.MDD_SERVER_URL || 'http://127.0.0.1:8010').replace(/\/+$/, '');
  try {
    const res = await fetch(`${url}/healthz`, {
      method: 'GET',
      signal: AbortSignal.timeout(1500),
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const capabilities: Record<string, Capability> = {
    firebase_admin: { configured: adminCredentialsConfigured() },
    firebase_storage: { configured: adminStorageConfigured() },
    firebase_web: {
      configured: configured(
        'NEXT_PUBLIC_FIREBASE_API_KEY',
        'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
        'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
      ),
    },
    stripe: {
      configured: configured('STRIPE_SECRET_KEY', 'STRIPE_MONTHLY_PRICE_ID', 'STRIPE_YEARLY_PRICE_ID'),
    },
    stripe_webhook: { configured: configured('STRIPE_WEBHOOK_SECRET') },
    azure_speech: { configured: configured('AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION') },
    mdd: {
      configured: true, // has a static default URL — always "configured"
      reachable: await probeMdd(),
    },
    openai: { configured: configured('OPENAI_API_KEY') },
    openai_images: { configured: configured('OPENAI_API_KEY') },
    elevenlabs: { configured: configured('ELEVENLABS_API_KEY') },
    twilio: { configured: configured('TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER') },
  };

  const requiredForV1 = ['firebase_admin', 'firebase_web', 'stripe', 'stripe_webhook', 'azure_speech', 'openai', 'elevenlabs'] as const;
  const missing = requiredForV1.filter((k) => !capabilities[k].configured);
  const status = missing.length === 0 ? 'ok' : 'degraded';

  return NextResponse.json(
    {
      status,
      missing,
      build: LITTLE_CHAPTERS_BUILD,
      capabilities,
      generatedAt: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        // A quick, human-cacheable answer; DON'T let a CDN or browser stash it for long.
        'Cache-Control': 'private, max-age=10, must-revalidate',
      },
    },
  );
}
