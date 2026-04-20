import { describe, expect, it } from 'vitest';

import { USD_TO_RUB } from '@/server/modules/billing/model-rates';

import { computeUsageLogRow } from '../writeUsageLog';

describe('computeUsageLogRow', () => {
  it('calculates snapshot costs from model rate', () => {
    const row = computeUsageLogRow({
      userId: 'user_abc',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      creditsCharged: 42,
      kind: 'chat',
    });

    // claude-sonnet-4-6: input 3.0 / output 15.0 per 1M
    // costUsd = 1.0 * 3 + 0.1 * 15 = 4.5
    expect(Number(row.costUsd)).toBeCloseTo(4.5, 6);
    expect(Number(row.costRub)).toBeCloseTo(4.5 * USD_TO_RUB, 4);
    expect(Number(row.exchangeRate)).toBe(USD_TO_RUB);
    expect(row.userId).toBe('user_abc');
    expect(row.kind).toBe('chat');
  });

  it('falls back to DEFAULT_MODEL_RATE for unknown models', () => {
    const row = computeUsageLogRow({
      userId: 'user_x',
      model: 'unknown-model-2099',
      provider: 'who',
      inputTokens: 1_000_000,
      outputTokens: 0,
      creditsCharged: 1,
      kind: 'chat',
    });
    // DEFAULT_MODEL_RATE: 3 / 15
    expect(Number(row.costUsd)).toBeCloseTo(3, 6);
  });

  it('zero tokens produces zero cost', () => {
    const row = computeUsageLogRow({
      userId: 'u',
      model: 'gpt-5-nano',
      provider: 'openai',
      inputTokens: 0,
      outputTokens: 0,
      creditsCharged: 1,
      kind: 'chat',
    });
    expect(Number(row.costUsd)).toBe(0);
    expect(Number(row.costRub)).toBe(0);
  });
});
