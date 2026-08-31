const buildTime = process.env.VERCEL_DEPLOYMENT_CREATED_AT || new Date().toISOString();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_LC_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || 'local',
    NEXT_PUBLIC_LC_BRANCH: process.env.VERCEL_GIT_COMMIT_REF || process.env.GIT_BRANCH || 'local',
    NEXT_PUBLIC_LC_BUILD_TIME: buildTime,
  },
};

module.exports = nextConfig;
