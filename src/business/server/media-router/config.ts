/**
 * Router-first media: configuration.
 *
 * "The router" is our llm-router (9router fork, `llm-router-v2.service`,
 * host port 3300). Its `flow-veo` service drives Google Flow on a pool of
 * Google One AI Pro accounts, so images (`flow/nano-banana`) and Veo 3.1 Fast
 * clips cost us nothing per call. The aggregator tries the router first for
 * eligible requests and falls back to WaveSpeed on any failure — the user
 * pays the same credits either way and never sees which backend served them.
 *
 * Design: docs/superpowers/specs/2026-09-22-router-first-media-routing-design.md
 *
 * Everything is env-driven so the feature can be switched off without a
 * deploy (`ROUTER_FIRST_MEDIA=` empty).
 */

export type RouterMediaKind = 'image' | 'video';

const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const csv = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export interface MediaRouterConfig {
  apiKey: string;
  baseUrl: string;
  breakerCooldownMs: number;
  breakerFails: number;
  enabled: Set<RouterMediaKind>;
  imageDeadlineMs: number;
  imageModel: string;
  /** 'all' — every eligible image request; 'newcomers' — only users in the newcomer window. */
  imageScope: 'all' | 'newcomers';
  videoDailyBudget: number;
  videoDeadlineMs: number;
  videoPlans: Set<string>;
  /** Free-trial clips allowed to fall back to WaveSpeed (our cost) per day. */
  videoTrialFallbackPerDay: number;
}

/** Read lazily so tests can set env before the first call. */
export function getMediaRouterConfig(): MediaRouterConfig {
  const env = process.env;
  const baseUrl = (env.LLM_ROUTER_URL ?? '').replace(/\/+$/, '');
  const enabled = new Set(csv(env.ROUTER_FIRST_MEDIA) as RouterMediaKind[]);
  // No URL → nothing can be routed regardless of the flag.
  if (!baseUrl) enabled.clear();

  return {
    apiKey: env.LLM_ROUTER_API_KEY ?? '',
    baseUrl,
    breakerCooldownMs: num(env.ROUTER_FIRST_BREAKER_COOLDOWN_MS, 15 * 60_000),
    breakerFails: num(env.ROUTER_FIRST_BREAKER_FAILS, 3),
    enabled,
    imageDeadlineMs: num(env.ROUTER_FIRST_IMAGE_DEADLINE_MS, 90_000),
    imageModel: env.LLM_ROUTER_IMAGE_MODEL || 'flow/nano-banana',
    imageScope: env.ROUTER_FIRST_IMAGE_SCOPE === 'newcomers' ? 'newcomers' : 'all',
    videoDailyBudget: num(env.ROUTER_FIRST_VIDEO_DAILY_BUDGET, 3),
    videoDeadlineMs: num(env.ROUTER_FIRST_VIDEO_DEADLINE_MS, 9 * 60_000),
    videoTrialFallbackPerDay: num(env.ROUTER_FIRST_TRIAL_FALLBACK_PER_DAY, 1),
    videoPlans: new Set(csv(env.ROUTER_FIRST_VIDEO_PLANS ?? 'basic,pro,pro_max,free')),
  };
}

export function isRouterFirstEnabled(kind: RouterMediaKind): boolean {
  return getMediaRouterConfig().enabled.has(kind);
}

/** `usage_logs.provider` / `async_tasks.metadata.servedBy` value for router-served results. */
export const ROUTER_PROVIDER_ID = 'llm-router';
