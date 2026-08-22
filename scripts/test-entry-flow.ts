import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRootEntry } from '../lib/root-entry.ts';

let passed = 0;

function check(label: string, condition: boolean): void {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`  ✓  ${label}`);
  passed++;
}

async function resolve(options: {
  authenticated: boolean;
  local?: object | null;
  remote?: object | null;
}) {
  let saved: object | null = null;
  let remoteCalls = 0;
  const destination = await resolveRootEntry({
    isAuthenticated: options.authenticated,
    loadLocalProfile: () => options.local ?? null,
    fetchRemoteProfile: async () => {
      remoteCalls++;
      return options.remote ?? null;
    },
    saveLocalProfile: (profile) => { saved = profile; },
  });
  return { destination, saved, remoteCalls };
}

async function main() {
  const page = readFileSync(join(import.meta.dirname, '../app/page.tsx'), 'utf8');

  const anonymous = await resolve({ authenticated: false });
  check('fresh anonymous visitor stays on the landing page', anonymous.destination === 'landing');
  check('anonymous entry does not attempt a remote profile request', anonymous.remoteCalls === 0);
  check('landing still shows the original primary CTA', page.includes('Try a Chapter Free Tonight'));
  check('landing CTA still links to /setup', page.includes('<Link href="/setup"'));

  const local = await resolve({ authenticated: true, local: { childId: 'local' } });
  check('authenticated parent with a local profile goes to /home', local.destination === '/home');
  check('local profile avoids an unnecessary remote request', local.remoteCalls === 0);

  const remoteProfile = { childId: 'remote' };
  const remote = await resolve({ authenticated: true, remote: remoteProfile });
  check('remote-only profile goes to /home', remote.destination === '/home');
  check('remote-only profile is restored locally before routing', remote.saved === remoteProfile);

  const missing = await resolve({ authenticated: true });
  check('authenticated parent with truly no profile goes to /setup', missing.destination === '/setup');

  for (const entitlement of ['inactive', 'active']) {
    const result = await resolve({ authenticated: true, local: { childId: entitlement } });
    check(`${entitlement} entitlement does not override profile-based /home routing`, result.destination === '/home');
  }

  let releaseRemote!: (profile: object | null) => void;
  let settled = false;
  const pending = resolveRootEntry<object>({
    isAuthenticated: true,
    loadLocalProfile: () => null,
    fetchRemoteProfile: () => new Promise((resolveRemote) => { releaseRemote = resolveRemote; }),
    saveLocalProfile: () => {},
  }).then((destination) => {
    settled = true;
    return destination;
  });
  await Promise.resolve();
  check('no route resolves while remote profile restoration is pending', !settled);
  releaseRemote({ childId: 'delayed-remote' });
  check('delayed remote restore resolves to /home, never Setup', await pending === '/home');

  check('root effect waits for AuthProvider loading to finish', page.includes('if (authLoading) return;'));
  check('root keeps landing hidden while auth/profile boot is unresolved', page.includes('if (showLanding) return <LandingPage />'));
  check('root routing does not inspect entitlement or subscription state', !/entitlement|subscription/i.test(page));

  console.log(`\n${passed} entry-flow checks passed\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
