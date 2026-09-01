import { isValidDay } from './chapter-id';

export function resolveAuthorizedChapterDay(input: { day: string; qaDay?: unknown; qaMode?: boolean; vercelEnvironment?: string; productionDay?: string }): string {
  if (input.qaMode === true) {
    if (input.vercelEnvironment === 'preview' && isValidDay(input.qaDay)) return input.qaDay;
    // A production client may put qaDay into `day` so preview requests carry
    // only one identity. Production replaces it with the server day.
    return isValidDay(input.productionDay) ? input.productionDay : input.day;
  }
  return input.day;
}
