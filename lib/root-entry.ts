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
 */
export async function resolveRootEntry<Profile>({
  isAuthenticated,
  loadLocalProfile,
  fetchRemoteProfile,
  saveLocalProfile,
}: RootEntryOptions<Profile>): Promise<RootEntryDestination> {
  if (!isAuthenticated) return 'landing';

  if (loadLocalProfile()) return '/home';

  const remoteProfile = await fetchRemoteProfile();
  if (!remoteProfile) return '/setup';

  saveLocalProfile(remoteProfile);
  return '/home';
}
