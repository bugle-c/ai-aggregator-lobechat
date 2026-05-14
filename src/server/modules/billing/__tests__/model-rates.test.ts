import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchRateMock = vi.fn();

vi.mock('@/server/services/billing/rates-source', () => ({
  fetchRate: fetchRateMock,
}));

const { calculateCreditsAsync, CREDIT_VALUE_RUB } = await import('../model-rates');

const makeTokenRate = (tierOverride: 'cheap' | 'mid' | 'high' | 'premium') => ({
  inputPer1M: 0,
  isActive: true,
  markup: 3,
  modelId: `${tierOverride}-model`,
  outputPer1M: 0,
  perUnit: null,
  pricingUnit: 'tokens' as const,
  provider: 'test',
  tierOverride,
});

describe('calculateCreditsAsync — tier-based unit economics', () => {
  beforeEach(() => {
    fetchRateMock.mockReset();
  });

  it.each([
    ['cheap', 10],
    ['mid', 5],
    ['high', 4],
    ['premium', 2.5],
  ] as const)(
    'charges %s provider cost with x%s multiplier and Math.ceil credits',
    async (tier, multiplier) => {
      fetchRateMock.mockResolvedValue(makeTokenRate(tier));

      const credits = await calculateCreditsAsync(`${tier}-model`, {
        kind: 'chat',
        providerCostUsd: 0.001,
        tokens: { inputTokens: 0, outputTokens: 0 },
      });

      expect(credits).toBe(Math.ceil((0.001 * 90 * multiplier) / CREDIT_VALUE_RUB));
    },
  );

  it('does not double-charge legacy rate.markup when provider cost is reported', async () => {
    fetchRateMock.mockResolvedValue({ ...makeTokenRate('premium'), markup: 99 });

    const credits = await calculateCreditsAsync('premium-model', {
      kind: 'chat',
      providerCostUsd: 0.001,
      tokens: { inputTokens: 10_000_000, outputTokens: 10_000_000 },
    });

    expect(credits).toBe(Math.ceil((0.001 * 90 * 2.5) / CREDIT_VALUE_RUB));
  });

  it('keeps explicitly free local models at zero credits', async () => {
    fetchRateMock.mockResolvedValue(makeTokenRate('cheap'));

    const credits = await calculateCreditsAsync('free-local', {
      kind: 'chat',
      providerCostUsd: 0,
      tokens: { inputTokens: 0, outputTokens: 0 },
    });

    expect(credits).toBe(0);
  });
});
