import type { ChildProfile } from './profile';

export type EntryState =
  | { kind: 'resolving' }
  | { kind: 'acquisition' }
  | { kind: 'setup' }
  | { kind: 'home'; profile: ChildProfile; source: 'local' | 'remote' };

export interface EntryFacts {
  authResolved: boolean;
  registered: boolean;
  localProfile: ChildProfile | null;
  remoteProfile: ChildProfile | null;
  remoteProfileResolved: boolean;
}

/** Recognition and entitlement are intentionally separate. */
export function resolveEntryState(facts: EntryFacts): EntryState {
  if (!facts.authResolved) return { kind: 'resolving' };
  if (facts.remoteProfile) return { kind: 'home', profile: facts.remoteProfile, source: 'remote' };
  if (facts.localProfile) return { kind: 'home', profile: facts.localProfile, source: 'local' };
  if (facts.registered && !facts.remoteProfileResolved) return { kind: 'resolving' };
  return facts.registered ? { kind: 'setup' } : { kind: 'acquisition' };
}

export type DailyStateKind = 'loading' | 'ready' | 'continue' | 'completed' | 'locked';

export interface DailyFacts {
  resolved: boolean;
  completedToday: boolean;
  hasCheckpoint?: boolean; // Wave 2 contract only; Wave 1 does not persist checkpoints.
  subscribed: boolean | null;
  freeChapterAvailable: boolean;
}

export function resolveDailyState(facts: DailyFacts): DailyStateKind {
  if (!facts.resolved) return 'loading';
  if (facts.completedToday) return 'completed';
  if (facts.hasCheckpoint) return 'continue';
  if (facts.subscribed === false && !facts.freeChapterAvailable) return 'locked';
  return 'ready';
}
