// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DailyQuota from '@/server/modules/billing/daily-quota';

import { getServerDB } from '@/database/core/db-adaptor';
import { FREE_DAILY_MESSAGE_QUOTA } from '@/server/modules/billing/daily-quota';

import { quoteRouter } from '../quote';
import { spendRouter } from '../spend';
import { subscriptionRouter } from '../subscription';

const mocks = vi.hoisted(() => ({
  getCreditBalance: vi.fn(),
  getActivePlans: vi.fn(),
  getUserHistory: vi.fn(),
  getUserPayments: vi.fn(),
  dailyCount: vi.fn(),
  requiredPlan: vi.fn(),
  modelAllowed: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn() }));
vi.mock('@/server/services/billing', () => ({
  BillingService: vi.fn().mockImplementation(() => ({
    getCreditBalance: mocks.getCreditBalance,
    getActivePlans: mocks.getActivePlans,
    getUserHistory: mocks.getUserHistory,
    getUserPayments: mocks.getUserPayments,
    getUserPlanSlug: vi.fn().mockResolvedValue('free'),
  })),
}));
vi.mock('@/business/server/media-router/newcomer', () => ({
  FREE_VIDEO_TRIAL_MODELS: { has: vi.fn().mockReturnValue(false) },
  getNewcomerState: vi.fn().mockResolvedValue(null),
  getFreeVideoTrial: vi.fn().mockResolvedValue({ left: 0 }),
}));
vi.mock('@/server/modules/billing/daily-quota', async (importOriginal) => ({
  ...(await importOriginal<typeof DailyQuota>()),
  countUserMessagesSince: mocks.dailyCount,
}));
vi.mock('@/server/modules/billing/intro-offer', () => ({
  paidBonusFor: vi.fn().mockResolvedValue(0),
}));
vi.mock('@/server/modules/billing/model-tiers', () => ({
  getRequiredPlanForModelAsync: mocks.requiredPlan,
  isModelAllowedForPlanAsync: mocks.modelAllowed,
}));
vi.mock('@/server/modules/billing/model-rates', () => ({
  calculateCreditsAsync: vi.fn().mockResolvedValue(12),
}));

const ctx = { authorizationHeader: 'Bearer mock-token', userId: 'refund-user' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getServerDB).mockResolvedValue(Object.create(null));
  mocks.getCreditBalance.mockResolvedValue({
    billing: {
      planId: 1,
      tokenBalance: 0,
      tokensUsedMonth: 50,
      bonusBalance: 0,
      bonusBalanceExpiresAt: null,
      monthStart: new Date(),
      subscriptionExpiresAt: null,
    },
    plan: { id: 1, slug: 'free', name: 'Free', tokenLimit: 50 },
    ordinaryRemaining: 0,
    refundRemaining: 20,
    creditsRemaining: 20,
    totalAvailable: 70,
  });
  mocks.getActivePlans.mockResolvedValue([]);
  mocks.dailyCount.mockResolvedValue(FREE_DAILY_MESSAGE_QUOTA + 1);
});

describe('refund-aware billing routers', () => {
  it('exposes the centralized remaining balance and refund cap in both summaries', async () => {
    const caller = spendRouter.createCaller(ctx);
    for (const summary of [await caller.getUsageSummary(), await caller.getCreditState()]) {
      expect(summary).toMatchObject({
        creditsRemaining: 20,
        refundRemaining: 20,
        totalAvailable: 70,
        creditsUsed: 50,
      });
    }
  });

  it('bypasses the exhausted free daily quota while leaving the plan free', async () => {
    const state = await spendRouter.createCaller(ctx).getCreditState();
    expect(state).toMatchObject({
      dailyGateBypassed: true,
      dailyRemaining: 0,
      purchasedRemaining: 20,
      planSlug: 'free',
    });
  });

  it('restores the daily quota gate when no unexpired refund remains', async () => {
    const balance = await mocks.getCreditBalance();
    mocks.getCreditBalance.mockResolvedValue({
      ...balance,
      refundRemaining: 0,
      creditsRemaining: 0,
      totalAvailable: 50,
    });
    expect(await spendRouter.createCaller(ctx).getCreditState()).toMatchObject({
      dailyGateBypassed: false,
      purchasedRemaining: 0,
      refundRemaining: 0,
    });
  });

  it('does not unlock paid models for users with refunds', async () => {
    mocks.modelAllowed.mockResolvedValue(false);
    mocks.requiredPlan.mockResolvedValue('pro');
    const result = await spendRouter.createCaller(ctx).requiredPlanForModel({ modelId: 'paid' });
    expect(result).toMatchObject({ isLocked: true, requiredPlan: { slug: 'pro' } });
    expect(mocks.modelAllowed).toHaveBeenCalledWith('paid', 'free');
  });

  it('quotes images and videos against remaining ordinary plus refund credits', async () => {
    const caller = quoteRouter.createCaller(ctx);
    expect(await caller.imageCost({ model: 'image' })).toEqual({
      balance: 20, credits: 12, sufficient: true,
    });
    expect(await caller.videoCost({ model: 'video', durationSeconds: 5 })).toEqual({
      balance: 20, credits: 12, sufficient: true,
    });
    const balance = await mocks.getCreditBalance.mock.results[0].value;
    mocks.getCreditBalance.mockResolvedValue({ ...balance, refundRemaining: 0, creditsRemaining: 0 });
    expect(await caller.imageCost({ model: 'image' })).toEqual({
      balance: 0, credits: 12, sufficient: false,
    });
  });

  it('returns mixed payment and refund history without inventing payment fields', async () => {
    const history = [
      { kind: 'refund', id: 'refund', granted: 20, credits: 20, status: 'credited', remaining: 20, description: 'Возврат кредитов из-за технической ошибки' },
      { kind: 'payment', id: 'payment', amountRub: 100 },
    ];
    mocks.getUserHistory.mockResolvedValue(history);
    mocks.getUserPayments.mockResolvedValue([history[1]]);
    const caller = subscriptionRouter.createCaller(ctx);
    expect(await caller.getCreditHistory()).toEqual(history);
    expect(await caller.getPayments()).toEqual([history[1]]);
    expect(await caller.getBillingState()).toMatchObject({
      creditsRemaining: 20, refundRemaining: 20, totalAvailable: 70,
    });
  });
});
