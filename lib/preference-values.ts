export type DifficultyObservation = 'too-easy' | 'about-right' | 'too-hard';
export type ParentCommunication = 'in-app' | 'sms' | 'off';
export type MusicPreferenceValue = 'off' | 'low' | 'normal';
export interface ConsumerPreferences {
  difficultyObservation: DifficultyObservation;
  music: MusicPreferenceValue;
  communication: ParentCommunication;
  phoneNumber: string;
}
export const DEFAULT_PREFERENCES: ConsumerPreferences = { difficultyObservation:'about-right', music:'normal', communication:'in-app', phoneNumber:'' };
export const PREFERENCES_KEY = 'little-chapters-preferences';
export function normalizePreferences(raw: Partial<ConsumerPreferences> | null | undefined): ConsumerPreferences {
  return {
    difficultyObservation: ['too-easy','about-right','too-hard'].includes(raw?.difficultyObservation ?? '') ? raw!.difficultyObservation! : 'about-right',
    music: ['off','low','normal'].includes(raw?.music ?? '') ? raw!.music! : 'normal',
    communication: ['in-app','sms','off'].includes(raw?.communication ?? '') ? raw!.communication! : 'in-app',
    phoneNumber: typeof raw?.phoneNumber === 'string' ? raw.phoneNumber.slice(0,30) : '',
  };
}
export function loadPreferenceValues(): ConsumerPreferences {
  try { return normalizePreferences(JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null')); }
  catch { return DEFAULT_PREFERENCES; }
}
