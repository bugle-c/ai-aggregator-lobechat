import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fulfillPayment } from '../fulfill';

// ---------------------------------------------------------------------------
// Hoisted mocks — BillingService is a class with static + instance methods,
// so we mock the module with a constructor that returns the shared spies.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  const getPaymentByYookassaId = vi.fn();
  const updatePaymentStatus = vi.fn(async () => undefined);
  const getOrCreateUserBilling = vi.fn();
  const getPlanById = vi.fn(async (id: number) => ({
    id,
    name: id === 1 ? 'Free' : 'Pro',
    slug: id === 1 ? 'free' : 'pro',
    priceRub: id === 1 ? 0 : 990,
    tokenLimit: 100_000,
    dailyCreditLimit: null,
    isActive: true,
  }));
  const updatePlan = vi.fn(async () => undefined);
  const addTokenBalance = vi.fn(async () => undefined);

  class BillingServiceMock {
    static getPaymentByYookassaId = getPaymentByYookassaId;
    static updatePaymentStatus = updatePaymentStatus;
    getOrCreateUserBilling = getOrCreateUserBilling;
    getPlanById = getPlanById;
    updatePlan = updatePlan;
    addTokenBalance = addTokenBalance;
  }

  return {
    BillingServiceMock,
    addTokenBalance,
    getOrCreateUserBilling,
    getPaymentByYookassaId,
    getPlanById,
    updatePaymentStatus,
    updatePlan,
  };
});

vi.mock('@/server/services/billing', () => ({ BillingService: mocks.BillingServiceMock }));
vi.mock('@/server/modules/analytics/writeSubscriptionEvent', () => ({
  writeSubscriptionEvent: vi.fn(async () => undefined),
}));
vi.mock('@/server/modules/billing/intro-offer', () => ({
  maybeGrantIntroOffer: vi.fn(async () => undefined),
}));
const sendConfirmationMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('@/server/modules/lifecycle/sendConfirmation', () => ({
  sendSubscriptionConfirmation: sendConfirmationMock,
}));

function makeDb() {
  const where = vi.fn(async () => undefined);
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return { update, _set: set } as any;
}

const NOW = new Date('2026-09-13T12:00:00Z');
const DAY = 86_400_000;

describe('fulfillPayment', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.getOrCreateUserBilling.mockResolvedValue({
      userId: 'u1',
      planId: 1,
      subscriptionExpiresAt: null,
      cancelledAt: null,
      tokensUsedMonth: 4200,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('resets the monthly counter in the same update as the plan change on first purchase', async () => {
    mocks.getPaymentByYookassaId.mockResolvedValue({
      id: 'p1',
      userId: 'u1',
      status: 'pending',
      type: 'subscription',
      planId: 2,
    });

    await fulfillPayment(makeDb(), 'yk-1');

    expect(mocks.updatePaymentStatus).toHaveBeenCalledWith(expect.anything(), 'p1', 'succeeded');
    expect(mocks.updatePlan).toHaveBeenCalledTimes(1);
    const [planId, expiresAt, opts] = mocks.updatePlan.mock.calls[0] as unknown as [
      number,
      Date,
      { resetMonthlyUsage?: boolean },
    ];
    expect(planId).toBe(2);
    expect(expiresAt.getTime()).toBe(NOW.getTime() + 30 * DAY);
    expect(opts).toEqual({ resetMonthlyUsage: true });
  });

  it('resets the counter on renewal too and extends from the current expiry', async () => {
    const currentExpiry = new Date(NOW.getTime() + 2 * DAY);
    mocks.getOrCreateUserBilling.mockResolvedValue({
      userId: 'u1',
      planId: 2,
      subscriptionExpiresAt: currentExpiry,
      cancelledAt: null,
      tokensUsedMonth: 90_000,
    });
    mocks.getPaymentByYookassaId.mockResolvedValue({
      id: 'p2',
      userId: 'u1',
      status: 'pending',
      type: 'subscription',
      planId: 2,
    });

    await fulfillPayment(makeDb(), 'yk-2');

    const [, expiresAt, opts] = mocks.updatePlan.mock.calls[0] as unknown as [
      number,
      Date,
      { resetMonthlyUsage?: boolean },
    ];
    expect(expiresAt.getTime()).toBe(currentExpiry.getTime() + 30 * DAY);
    expect(opts).toEqual({ resetMonthlyUsage: true });
  });

  it('leaves the counter alone on a top-up', async () => {
    mocks.getPaymentByYookassaId.mockResolvedValue({
      id: 'p3',
      userId: 'u1',
      status: 'pending',
      type: 'topup',
      tokensAmount: 500,
    });

    await fulfillPayment(makeDb(), 'yk-3');

    expect(mocks.updatePlan).not.toHaveBeenCalled();
    expect(mocks.addTokenBalance).toHaveBeenCalledWith(500);
  });

  it('is a no-op for an already succeeded payment', async () => {
    mocks.getPaymentByYookassaId.mockResolvedValue({
      id: 'p4',
      userId: 'u1',
      status: 'succeeded',
      type: 'subscription',
      planId: 2,
    });

    await fulfillPayment(makeDb(), 'yk-4');

    expect(mocks.updatePaymentStatus).not.toHaveBeenCalled();
    expect(mocks.updatePlan).not.toHaveBeenCalled();
  });
  // =========================================================================
  // Confirmation email — recurring disclosure inputs
  // =========================================================================

  it('tells the confirmation email the card was saved, with the amount and next charge date', async () => {
    mocks.getPaymentByYookassaId.mockResolvedValue({
      id: 'p5',
      userId: 'u1',
      status: 'pending',
      type: 'subscription',
      planId: 2,
      amountRub: 490,
    });

    await fulfillPayment(makeDb(), 'yk-5', { savedPaymentMethodId: 'pm_live_1' });

    const arg = (sendConfirmationMock.mock.calls[0] as any[])[1];
    expect(arg.autoRenew).toBe(true);
    // The amount actually paid, not the current list price (990).
    expect(arg.priceRub).toBe(490);
    expect(arg.expiresAt.getTime()).toBe(NOW.getTime() + 30 * DAY);
  });

  it('does NOT claim auto-renewal when no card is on file (one-shot purchase)', async () => {
    // YOOKASSA_RECURRING_ENABLED off, or YK refused save_payment_method.
    mocks.getOrCreateUserBilling.mockResolvedValue({
      userId: 'u1',
      planId: 1,
      subscriptionExpiresAt: null,
      cancelledAt: null,
      autoRenew: true,
      paymentMethodId: null,
      tokensUsedMonth: 0,
    });
    mocks.getPaymentByYookassaId.mockResolvedValue({
      id: 'p6',
      userId: 'u1',
      status: 'pending',
      type: 'subscription',
      planId: 2,
      amountRub: 490,
    });

    await fulfillPayment(makeDb(), 'yk-6');

    expect((sendConfirmationMock.mock.calls[0] as any[])[1].autoRenew).toBe(false);
  });

  it('claims auto-renewal on a cron renewal charge (card already on file)', async () => {
    mocks.getOrCreateUserBilling.mockResolvedValue({
      userId: 'u1',
      planId: 2,
      subscriptionExpiresAt: new Date(NOW.getTime() + DAY),
      cancelledAt: null,
      autoRenew: true,
      paymentMethodId: 'pm_live_1',
      tokensUsedMonth: 0,
    });
    mocks.getPaymentByYookassaId.mockResolvedValue({
      id: 'p7',
      userId: 'u1',
      status: 'pending',
      type: 'subscription',
      planId: 2,
      amountRub: 490,
    });

    await fulfillPayment(makeDb(), 'yk-7');

    expect((sendConfirmationMock.mock.calls[0] as any[])[1].autoRenew).toBe(true);
  });

  it('does not claim auto-renewal for a user who cancelled and has no card', async () => {
    mocks.getOrCreateUserBilling.mockResolvedValue({
      userId: 'u1',
      planId: 2,
      subscriptionExpiresAt: new Date(NOW.getTime() + DAY),
      cancelledAt: new Date(NOW.getTime() - DAY),
      autoRenew: false,
      paymentMethodId: null,
      tokensUsedMonth: 0,
    });
    mocks.getPaymentByYookassaId.mockResolvedValue({
      id: 'p8',
      userId: 'u1',
      status: 'pending',
      type: 'subscription',
      planId: 2,
      amountRub: 490,
    });

    await fulfillPayment(makeDb(), 'yk-8');

    expect((sendConfirmationMock.mock.calls[0] as any[])[1].autoRenew).toBe(false);
  });
});
