import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isRouterPaused, recordRouterOutcome, resetRouterBreaker } from '../breaker';

describe('media-router breaker', () => {
  beforeEach(() => {
    process.env.LLM_ROUTER_URL = 'http://router.test';
    process.env.ROUTER_FIRST_BREAKER_FAILS = '3';
    process.env.ROUTER_FIRST_BREAKER_COOLDOWN_MS = '60000';
    resetRouterBreaker();
  });
  afterEach(() => resetRouterBreaker());

  it('pauses after N consecutive failures and recovers after the cooldown', () => {
    const t0 = 1_000_000;
    recordRouterOutcome('video', 'upstream', undefined, t0);
    recordRouterOutcome('video', 'timeout', undefined, t0);
    expect(isRouterPaused('video', t0)).toBe(false);
    recordRouterOutcome('video', 'upstream', undefined, t0);
    expect(isRouterPaused('video', t0)).toBe(true);
    expect(isRouterPaused('video', t0 + 60_001)).toBe(false);
    expect(isRouterPaused('image', t0)).toBe(false); // kinds are independent
  });

  it('an ok resets the failure streak; invalid requests never trip it', () => {
    const t0 = 1_000_000;
    recordRouterOutcome('image', 'upstream', undefined, t0);
    recordRouterOutcome('image', 'upstream', undefined, t0);
    recordRouterOutcome('image', 'ok', undefined, t0);
    recordRouterOutcome('image', 'invalid', undefined, t0);
    recordRouterOutcome('image', 'upstream', undefined, t0);
    recordRouterOutcome('image', 'upstream', undefined, t0);
    expect(isRouterPaused('image', t0)).toBe(false);
  });

  it('a 429 with Retry-After pauses at once, for at least that long', () => {
    const t0 = 1_000_000;
    recordRouterOutcome('video', 'quota', 5 * 60_000, t0);
    expect(isRouterPaused('video', t0 + 4 * 60_000)).toBe(true);
    expect(isRouterPaused('video', t0 + 5 * 60_000 + 1)).toBe(false);
  });
});
