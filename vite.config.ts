import { resolve } from 'node:path';

import type { PluginOption } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import {
  sharedOptimizeDeps,
  sharedRendererDefine,
  sharedRendererPlugins,
  sharedRollupOutput,
} from './plugins/vite/sharedRendererConfig';

const isMobile = process.env.MOBILE === 'true';
const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';

Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

const isDev = process.env.NODE_ENV !== 'production';
const platform = isMobile ? 'mobile' : 'web';

export default defineConfig({
  base: isDev ? '/' : process.env.VITE_CDN_BASE || '/spa/',
  build: {
    outDir: isMobile ? 'dist/mobile' : 'dist/desktop',
    rollupOptions: {
      external: [
        // Server-only / optional provider deps not needed in SPA bundle (resolve fails in Docker otherwise)
        '@aws-sdk/client-bedrock-runtime',
      ],
      input: resolve(__dirname, isMobile ? 'index.mobile.html' : 'index.html'),
      output: sharedRollupOutput,
    },
  },
  define: sharedRendererDefine({ isMobile, isElectron: false }),
  optimizeDeps: sharedOptimizeDeps,
  plugins: [
    ...sharedRendererPlugins({ platform }),

    VitePWA({
      injectRegister: null,
      manifest: false,
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        runtimeCaching: [
          {
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
          },
          {
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365, maxEntries: 30 },
            },
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
          },
          {
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'image-assets',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 30, maxEntries: 100 },
            },
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico|avif)$/i,
          },
          {
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxAgeSeconds: 60 * 5, maxEntries: 50 },
            },
            urlPattern: /\/(api|trpc)\/.*/i,
          },
        ],
      },
    }),
  ].filter(Boolean) as PluginOption[],

  server: {
    cors: true,
    port: 9876,
    proxy: {
      '/api': 'http://localhost:3010',
      '/oidc': 'http://localhost:3010',
      '/trpc': 'http://localhost:3010',
      '/webapi': 'http://localhost:3010',
    },
    warmup: {
      clientFiles: ['./src/entry.web.tsx', './src/entry.desktop.tsx', './src/entry.mobile.tsx'],
    },
  },
});
