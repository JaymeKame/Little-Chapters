'use client';

import type { User } from 'firebase/auth';
import { loadProfile, saveProfile, type ChildProfile } from './profile';

export interface ResolvedProfile {
  profile: ChildProfile | null;
  source: 'local' | 'remote' | 'none' | 'unavailable';
}

async function request(user: User, init?: RequestInit): Promise<Response> {
  return fetch('/api/profile', {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...init?.headers,
    },
  });
}

export async function saveAccountProfile(user: User, profile: ChildProfile): Promise<void> {
  if (user.isAnonymous) return;
  const response = await request(user, { method: 'POST', body: JSON.stringify({ profile }) });
  if (!response.ok) throw new Error('Could not save the child profile.');
  saveProfile(profile);
}

/** Remote wins for registered families; a pre-registration local profile is
 * claimed into an empty account exactly once. Anonymous use stays local. */
export async function resolveProfile(user: User | null): Promise<ResolvedProfile> {
  const local = loadProfile();
  if (!user || user.isAnonymous) return { profile: local, source: local ? 'local' : 'none' };
  const response = await request(user);
  if (!response.ok) return { profile: local, source: local ? 'local' : 'unavailable' };
  const data = (await response.json()) as { profile?: ChildProfile | null };
  if (data.profile) {
    saveProfile(data.profile);
    return { profile: data.profile, source: 'remote' };
  }
  if (local) {
    await saveAccountProfile(user, local);
    return { profile: local, source: 'local' };
  }
  return { profile: null, source: 'none' };
}
