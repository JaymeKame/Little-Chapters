export type ChapterEntitlementSource = 'free' | 'subscription';

export function decideChapterEntitlement(input: {
  chapterId: string;
  existingSource?: ChapterEntitlementSource | null;
  subscribed: boolean;
  consumedFreeChapterId?: string | null;
}): ChapterEntitlementSource | null {
  if (input.existingSource) return input.existingSource;
  if (input.subscribed) return 'subscription';
  if (!input.consumedFreeChapterId || input.consumedFreeChapterId === input.chapterId) return 'free';
  return null;
}
