/**
 * Circuit breaker for the media router, per kind (image / video).
 *
 * In-memory on purpose: the aggregator runs as a single container
 * (`lobehub`), and the worst case after a restart is one extra probe of a
 * dead router before the breaker re-opens. `quota` (429), `upstream`
 * (5xx / connection) and `timeout` count as failures; `ok` resets. While
 * paused, callers skip the router entirely, so a dead pool adds zero latency
 * for users.
 */
import { getMediaRouterConfig, type RouterMediaKind } from './config';

export type RouterOutcome = 'ok' | 'quota' | 'upstream' | 'timeout' | 'invalid';

interface BreakerState {
  fails: number;
  pausedUntil: number;
}

const state: Record<RouterMediaKind, BreakerState> = {
  image: { fails: 0, pausedUntil: 0 },
  video: { fails: 0, pausedUntil: 0 },
};

export function isRouterPaused(kind: RouterMediaKind, now = Date.now()): boolean {
  return state[kind].pausedUntil > now;
}

/**
 * Record an outcome. `retryAfterMs` (from a 429 `Retry-After`) never shortens
 * the pause below the configured cooldown.
 */
export function recordRouterOutcome(
  kind: RouterMediaKind,
  outcome: RouterOutcome,
  retryAfterMs?: number,
  now = Date.now(),
): void {
  const s = state[kind];
  if (outcome === 'ok' || outcome === 'invalid') {
    // 'invalid' is our request being wrong, not the router being down.
    if (outcome === 'ok') s.fails = 0;
    return;
  }
  const { breakerFails, breakerCooldownMs } = getMediaRouterConfig();
  s.fails += 1;
  if (s.fails >= breakerFails || (outcome === 'quota' && retryAfterMs)) {
    const pause = Math.max(breakerCooldownMs, retryAfterMs ?? 0);
    s.pausedUntil = now + pause;
    s.fails = 0;
    console.warn(
      `[media-router] ${kind}: paused for ${Math.round(pause / 1000)}s after ${outcome}`,
    );
  }
}

/** Test helper. */
export function resetRouterBreaker(): void {
  state.image = { fails: 0, pausedUntil: 0 };
  state.video = { fails: 0, pausedUntil: 0 };
}
