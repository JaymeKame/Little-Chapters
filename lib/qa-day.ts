import { isValidDay } from './chapter-id';

export function resolveAuthorizedChapterDay(input: { day: string; qaDay?: unknown; qaMode?: boolean; vercelEnvironment?: string }): string {
  return input.vercelEnvironment === 'preview' && input.qaMode === true && isValidDay(input.qaDay)
    ? input.qaDay
    : input.day;
}
