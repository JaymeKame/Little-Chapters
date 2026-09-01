export interface LittleChaptersBuild { commitSha: string; branch: string; buildTime: string }

export const LITTLE_CHAPTERS_BUILD: LittleChaptersBuild = Object.freeze({
  commitSha: process.env.NEXT_PUBLIC_LC_COMMIT_SHA || 'unknown',
  branch: process.env.NEXT_PUBLIC_LC_BRANCH || 'unknown',
  buildTime: process.env.NEXT_PUBLIC_LC_BUILD_TIME || 'unknown',
});
