import { strict as assert } from 'node:assert';
import { resolveDailyState, resolveEntryState } from '../lib/entry-state.ts';
import { exactlyOnce } from '../lib/exactly-once.ts';
import { APPROVED_SCENE_IDS, RUNTIME_SCENE_MANIFEST, SCENE_MANIFEST, sceneApproval } from '../lib/scene-manifest.ts';
import type { ChildProfile } from '../lib/profile.ts';

const profile: ChildProfile = { childId: 'child-1', childName: 'Sam', age: 6, interests: ['dogs'], createdAt: 1 };
const entry = (overrides: Partial<Parameters<typeof resolveEntryState>[0]>) => resolveEntryState({
  authResolved: true, registered: false, localProfile: null, remoteProfile: null, remoteProfileResolved: true, ...overrides,
});

assert.equal(entry({}).kind, 'acquisition', 'new anonymous visitor sees acquisition');
assert.equal(entry({ localProfile: profile }).kind, 'home', 'known anonymous profile goes home');
assert.equal(entry({ registered: true, remoteProfile: profile }).kind, 'home', 'registered remote profile goes home');
assert.equal(entry({ registered: true }).kind, 'setup', 'registered missing profile goes to setup');
assert.equal(entry({ registered: true, remoteProfileResolved: false }).kind, 'resolving', 'remote lookup never flashes setup');
assert.equal(resolveEntryState({ authResolved: false, registered: false, localProfile: null, remoteProfile: null, remoteProfileResolved: false }).kind, 'resolving');

assert.equal(resolveDailyState({ resolved: false, completedToday: false, subscribed: null, freeChapterAvailable: true }), 'loading');
assert.equal(resolveDailyState({ resolved: true, completedToday: false, subscribed: true, freeChapterAvailable: false }), 'ready');
assert.equal(resolveDailyState({ resolved: true, completedToday: false, subscribed: false, freeChapterAvailable: true }), 'ready');
assert.equal(resolveDailyState({ resolved: true, completedToday: false, subscribed: false, freeChapterAvailable: false }), 'locked');
assert.equal(resolveDailyState({ resolved: true, completedToday: true, subscribed: false, freeChapterAvailable: false }), 'completed');
assert.equal(resolveDailyState({ resolved: true, completedToday: false, hasCheckpoint: true, subscribed: true, freeChapterAvailable: false }), 'continue');

let completions = 0;
const complete = exactlyOnce(() => { completions += 1; });
complete(); complete(); complete();
assert.equal(completions, 1, 'audio completion fires exactly once');

assert.equal(RUNTIME_SCENE_MANIFEST.length, APPROVED_SCENE_IDS.length);
assert.ok(RUNTIME_SCENE_MANIFEST.every((asset) => sceneApproval(asset.id) === 'approved'));
assert.ok(SCENE_MANIFEST.some((asset) => sceneApproval(asset.id) === 'quarantined'));

console.log('Product foundation: 16 passed, 0 failed');
