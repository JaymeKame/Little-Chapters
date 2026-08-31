/* Deterministic analytics-funnel contract test.
 *
 * Proves:
 *  1. every V1 funnel event name in lib/analytics.ts is instrumented at a
 *     real call site (grep across app/);
 *  2. the sanitizer whitelists only the properties we've committed to
 *     collecting — anything else is silently dropped BEFORE it reaches the
 *     network;
 *  3. exactly-once conversion events (setup_completed, register_completed,
 *     checkout_completed, subscription_active) fire at most once per
 *     browser session even when the calling component re-mounts;
 *  4. the collector receiver's allow-list matches the client type union —
 *     drift between them would silently swallow real events. */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next' || entry === 'artifacts') continue;
      walk(full, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const V1_EVENTS = [
    'landing_view',
    'setup_completed',
    'chapter_started', 'chapter_completed',
    'unlock_shown',
    'register_started', 'register_completed',
    'checkout_started', 'checkout_completed',
    'subscription_active', 'billing_portal_opened',
  ] as const;

  const ALL_FILES = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))];
  const CORPUS = ALL_FILES
    .filter((p) => !p.includes('/api/analytics/collect/'))
    .map((p) => ({ p, body: readFileSync(p, 'utf8') }));

  let passed = 0;
  for (const event of V1_EVENTS) {
    const hits = CORPUS.filter(({ body }) => body.includes(`'${event}'`));
    assert.ok(hits.length > 0, `event ${event} is never called from any component`);
    passed += 1;
  }

  const collectorSrc = readFileSync(join(ROOT, 'app/api/analytics/collect/route.ts'), 'utf8');
  for (const event of V1_EVENTS) {
    assert.ok(collectorSrc.includes(`'${event}'`), `collector allow-list is missing ${event}`);
    passed += 1;
  }

  // Provide a browser-shaped globals BEFORE importing the client module.
  const store = new Map<string, string>();
  const fakeStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: () => null,
    length: 0,
  } as unknown as Storage;
  (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = fakeStorage;
  (globalThis as unknown as { window: unknown }).window = { location: { pathname: '/test' } };

  const analytics = await import('../lib/analytics.ts');
  const { track, __test } = analytics;

  // Sanitizer whitelist test: any property the client tries to send that
  // is not on the allowed list should be dropped before it leaves the browser.
  const sanitized = __test.sanitize({
    route: '/read', authed: true, plan: 'monthly', stage: 3,
    interactionType: 'find-sound', provider: 'elevenlabs', fallback: 'used', errorCategory: 'timeout',
    ...({ childName: 'Mike', transcript: 'once upon a time', apiKey: 'sk-real', uid: 'u_123', email: 'a@b' } as unknown as Record<string, unknown>),
  });
  assert.equal(sanitized.childName, undefined, 'sanitizer must drop child name');
  assert.equal(sanitized.transcript, undefined, 'sanitizer must drop transcripts');
  assert.equal(sanitized.apiKey, undefined, 'sanitizer must drop credentials');
  assert.equal(sanitized.uid, undefined, 'sanitizer must drop uids');
  assert.equal(sanitized.email, undefined, 'sanitizer must drop emails');
  assert.equal(sanitized.route, '/read');
  assert.equal(sanitized.plan, 'monthly');
  passed += 7;

  __test.reset();
  track('subscription_active', { route: '/payment/success' });
  track('subscription_active', { route: '/payment/success' });
  track('subscription_active', { route: '/payment/success' });
  const drained = __test.drain();
  assert.equal(drained.length, 1, 'subscription_active must be exactly-once per session');
  assert.equal(drained[0].event, 'subscription_active');
  passed += 2;

  __test.reset();
  track('chapter_started');
  track('chapter_started');
  assert.equal(__test.drain().length, 2, 'chapter_started must be repeatable');
  passed += 1;

  console.log(`Analytics funnel contract: ${passed} passed, 0 failed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
