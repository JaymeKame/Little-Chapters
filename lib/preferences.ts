'use client';

import type { User } from 'firebase/auth';
import { audioSession } from './audio-session';
import { DEFAULT_PREFERENCES, PREFERENCES_KEY, loadPreferenceValues, normalizePreferences, type ConsumerPreferences } from './preference-values';
export { DEFAULT_PREFERENCES, type ConsumerPreferences, type DifficultyObservation, type ParentCommunication } from './preference-values';

export function loadPreferences(): ConsumerPreferences {
  return loadPreferenceValues();
}

export function savePreferencesLocal(preferences: ConsumerPreferences): ConsumerPreferences {
  const value = normalizePreferences(preferences);
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(value));
  audioSession.setMusicPreference(value.music);
  return value;
}

async function request(user: User, init?: RequestInit): Promise<Response> {
  return fetch('/api/preferences', {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
  });
}

export async function resolvePreferences(user: User | null): Promise<ConsumerPreferences> {
  const local = loadPreferences();
  if (!user || user.isAnonymous) { audioSession.setMusicPreference(local.music); return local; }
  const response = await request(user);
  if (!response.ok) { audioSession.setMusicPreference(local.music); return local; }
  const data = await response.json() as { preferences?: Partial<ConsumerPreferences> };
  const merged = savePreferencesLocal(normalizePreferences(data.preferences ?? local));
  return merged;
}

export async function savePreferences(user: User | null, preferences: ConsumerPreferences): Promise<ConsumerPreferences> {
  const value = savePreferencesLocal(preferences);
  if (user && !user.isAnonymous) {
    const response = await request(user, { method: 'POST', body: JSON.stringify({ preferences: value }) });
    if (!response.ok) throw new Error('Could not save settings. Please try again.');
  }
  return value;
}
