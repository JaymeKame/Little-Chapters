export type RootEntryDestination = 'landing' | '/home' | '/setup';

interface RootEntryOptions<Profile> {
  isAuthenticated: boolean;
  loadLocalProfile: () => Profile | null;
  fetchRemoteProfile: () => Promise<Profile | null>;
  saveLocalProfile: (profile: Profile) => void;
}

/**
 * Resolves the root entry without consulting entitlement state. A parent who
 * has a child profile owns that history whether their subscription is active
 * or not; Home is responsible for deciding whether today's chapter is gated.
 *
 * The local-profile check runs BEFORE isAuthenticated on purpose: an
 * anonymous parent who completed the free-demo Setup already owns a real
 * child profile and reading history on this browser, with or without ever
 * registering (per this app's account-free demo model). Gating on
 * isAuthenticated first — as an earlier version of this function did —
 * treated every anonymous returning visitor as brand-new, sending them back
 * to the acquisition landing page regardless of an existing profile. Since
 * loadLocalProfile() is synchronous and free, checking it first costs
 * nothing for the registered-user path either. Remote restoration remains
 * gated on isAuthenticated, since there is no server-side record to
 * recover for a visitor who never registered — this deliberately does not
 * attempt cross-device recovery for an anonymous identity.
 */
export async function resolveRootEntry<Profile>({
  isAuthenticated,
  loadLocalProfile,
  fetchRemoteProfile,
  saveLocalProfile,
}: RootEntryOptions<Profile>): Promise<RootEntryDestination> {
  if (loadLocalProfile()) return '/home';

  if (!isAuthenticated) return 'landing';

  const remoteProfile = await fetchRemoteProfile();
  if (!remoteProfile) return '/setup';

  saveLocalProfile(remoteProfile);
  return '/home';
}
