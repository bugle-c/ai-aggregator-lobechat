import { defineConfig } from './src/libs/next/config/define-config';

const isVercel = !!process.env.VERCEL_ENV;

const nextConfig = defineConfig({
  // Vercel serverless optimization: exclude musl binaries and ffmpeg from all routes
  // Vercel uses Amazon Linux (glibc), not Alpine Linux (musl)
  // ffmpeg-static (~76MB) is only needed by /api/webhooks/video/* route
  // This saves ~120MB (29MB canvas-musl + 16MB sharp-musl + 76MB ffmpeg)
  outputFileTracingExcludes: isVercel
    ? {
        '*': [
          'node_modules/.pnpm/@napi-rs+canvas-*-musl*',
          'node_modules/.pnpm/@img+sharp-libvips-*musl*',
          'node_modules/ffmpeg-static/**',
          'node_modules/.pnpm/ffmpeg-static*/**',
        ],
      }
    : undefined,
  // Include ffmpeg binary for video webhook processing on BOTH Vercel and self-host.
  // Next.js' nft tracer skips binary assets that aren't reachable through static
  // require analysis, so without this hint the ffmpeg binary never lands in
  // `.next/standalone/node_modules/ffmpeg-static/`. The webhook then crashes with
  // `spawn ENOENT` on every successful WaveSpeed video callback, breaking the
  // entire video pipeline. Refs: https://github.com/vercel-labs/ffmpeg-on-vercel
  outputFileTracingIncludes: {
    '/api/webhooks/video/*': ['./node_modules/ffmpeg-static/ffmpeg'],
  },
  webpack: (webpackConfig, context) => {
    const { dev } = context;
    if (!dev) {
      webpackConfig.cache = false;
    }

    return webpackConfig;
  },
});

export default nextConfig;
