import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as ExpiringModule from '../expiringSubscriptions';
import { runExpiryReminders } from '../runExpiryReminders';

const mocks = vi.hoisted(() => ({
  listExpired: vi.fn(async (): Promise<any[]> => []),
  listExpiring: vi.fn(async (): Promise<any[]> => []),
  markReminderSent: vi.fn(async () => undefined),
  sendLifecycleEmail: vi.fn(async () => ({ ok: true, messageId: 'm' })),
  sendTelegram: vi.fn(async () => ({ ok: true })),
  sendUpcomingChargeTg: vi.fn(async () => ({ ok: true })),
  fetchLastPaid: vi.fn(async (): Promise<any> => null),
}));

vi.mock('../expiringSubscriptions', async (importOriginal) => {
  const actual = await importOriginal<typeof ExpiringModule>();
  return {
    ...actual,
    listExpiredSubscriptions: mocks.listExpired,
    listExpiringSubscriptions: mocks.listExpiring,
    markReminderSent: mocks.markReminderSent,
  };
});
vi.mock('../email', () => ({ sendLifecycleEmail: mocks.sendLifecycleEmail }));
vi.mock('../telegram', () => ({
  sendSubscriptionExpiredTelegram: mocks.sendTelegram,
  sendUpcomingChargeTelegram: mocks.sendUpcomingChargeTg,
}));
vi.mock('@/server/modules/billing/renewalAmount', () => ({
  fetchLastSubscriptionPayment: mocks.fetchLastPaid,
  resolveRenewalAmount: (lastPaid: any, planId: number, current: number) =>
    lastPaid && lastPaid.planId === planId ? lastPaid.amountRub : current,
}));

const db = {} as any;
const NOW = new Date('2026-09-13T12:00:00Z');
const DAY = 86_400_000;

const expiringRow = (over: Partial<Record<string, unknown>> = {}) => ({
  email: 'real@example.com',
  planId: 2,
  planName: 'Pro',
  planPriceRub: 990,
  subscriptionExpiresAt: new Date(NOW.getTime() + 2.5 * DAY),
  tgBotChatId: null,
  userId: 'u-expiring',
  ...over,
});

const expiredRow = (over: Partial<Record<string, unknown>> = {}) => ({
  email: 'real@example.com',
  expiredAt: new Date(NOW.getTime() - 3 * 3_600_000),
  planId: 2,
  planName: 'Pro',
  tgBotChatId: null,
  userId: 'u-expired',
  ...over,
});

describe('runExpiryReminders', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.listExpired.mockResolvedValue([]);
    mocks.listExpiring.mockResolvedValue([]);
    mocks.sendLifecycleEmail.mockResolvedValue({ ok: true, messageId: 'm' });
    mocks.sendTelegram.mockResolvedValue({ ok: true });
    mocks.sendUpcomingChargeTg.mockResolvedValue({ ok: true });
    mocks.fetchLastPaid.mockResolvedValue(null);
  });

  it('returns immediately when nothing is due — no sends, no stamps', async () => {
    const summary = await runExpiryReminders(db);

    expect(summary.expiring.due).toBe(0);
    expect(summary.expired.due).toBe(0);
    expect(mocks.sendLifecycleEmail).not.toHaveBeenCalled();
    expect(mocks.sendTelegram).not.toHaveBeenCalled();
    expect(mocks.markReminderSent).not.toHaveBeenCalled();
  });

  it('T-3: emails the reminder and stamps the user', async () => {
    mocks.listExpiring.mockResolvedValue([expiringRow()]);

    const summary = await runExpiryReminders(db);

    expect(summary.expiring).toMatchObject({ due: 1, emailSent: 1, failed: 0 });
    expect(mocks.sendLifecycleEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('истекает'),
        to: 'real@example.com',
      }),
    );
    expect(mocks.markReminderSent).toHaveBeenCalledWith(db, 'u-expiring');
  });

  it('T-3: skips a synthetic (telegram) email but still stamps so it is not re-selected', async () => {
    mocks.listExpiring.mockResolvedValue([expiringRow({ email: 'tg_123@bot.gptweb.ru' })]);

    const summary = await runExpiryReminders(db);

    expect(summary.expiring).toMatchObject({ emailSent: 0, skippedNoChannel: 1 });
    expect(mocks.sendLifecycleEmail).not.toHaveBeenCalled();
    expect(mocks.markReminderSent).toHaveBeenCalledWith(db, 'u-expiring');
  });

  it('T-3: does not stamp on a failed send so the next tick retries', async () => {
    mocks.listExpiring.mockResolvedValue([expiringRow()]);
    mocks.sendLifecycleEmail.mockResolvedValue({ ok: false, error: 'HTTP 503' } as any);

    const summary = await runExpiryReminders(db);

    expect(summary.expiring).toMatchObject({ emailSent: 0, failed: 1 });
    expect(mocks.markReminderSent).not.toHaveBeenCalled();
  });

  it('T0: emails «тариф закончился» and DMs Telegram when a bot chat exists', async () => {
    mocks.listExpired.mockResolvedValue([expiredRow({ tgBotChatId: 4242 })]);

    const summary = await runExpiryReminders(db);

    expect(summary.expired).toMatchObject({ due: 1, emailSent: 1, tgSent: 1, failed: 0 });
    expect(mocks.sendLifecycleEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('закончился'),
        to: 'real@example.com',
      }),
    );
    expect(mocks.sendTelegram).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 4242, planName: 'Pro' }),
    );
    expect(mocks.markReminderSent).toHaveBeenCalledWith(db, 'u-expired');
  });

  it('T0: synthetic email + bot chat → Telegram only', async () => {
    mocks.listExpired.mockResolvedValue([
      expiredRow({ email: 'tg_77@bot.gptweb.ru', tgBotChatId: 77 }),
    ]);

    const summary = await runExpiryReminders(db);

    expect(summary.expired).toMatchObject({ emailSent: 0, tgSent: 1 });
    expect(mocks.sendLifecycleEmail).not.toHaveBeenCalled();
    expect(mocks.markReminderSent).toHaveBeenCalledWith(db, 'u-expired');
  });

  it('T0: no channel at all → stamped without sending', async () => {
    mocks.listExpired.mockResolvedValue([expiredRow({ email: null, tgBotChatId: null })]);

    const summary = await runExpiryReminders(db);

    expect(summary.expired).toMatchObject({ skippedNoChannel: 1, emailSent: 0, tgSent: 0 });
    expect(mocks.markReminderSent).toHaveBeenCalledWith(db, 'u-expired');
  });

  it('T0: stamps when one channel delivered even if the other failed', async () => {
    mocks.listExpired.mockResolvedValue([expiredRow({ tgBotChatId: 1 })]);
    mocks.sendTelegram.mockResolvedValue({ ok: false, error: 'blocked' } as any);

    const summary = await runExpiryReminders(db);

    expect(summary.expired).toMatchObject({ emailSent: 1, tgSent: 0, failed: 0 });
    expect(mocks.markReminderSent).toHaveBeenCalledWith(db, 'u-expired');
  });

  it('T0: synthetic email + chat that blocked the bot → stamped as "no channel", not retried', async () => {
    mocks.listExpired.mockResolvedValue([
      expiredRow({ email: 'tg_9@bot.gptweb.ru', tgBotChatId: 9 }),
    ]);
    mocks.sendTelegram.mockResolvedValue({ ok: false, error: 'blocked', permanent: true } as any);

    const summary = await runExpiryReminders(db);

    expect(summary.expired).toMatchObject({ tgSent: 0, failed: 0, skippedNoChannel: 1 });
    expect(mocks.markReminderSent).toHaveBeenCalledWith(db, 'u-expired');
  });

  it('T0: synthetic email + bot transiently down → left unstamped for retry', async () => {
    mocks.listExpired.mockResolvedValue([
      expiredRow({ email: 'tg_9@bot.gptweb.ru', tgBotChatId: 9 }),
    ]);
    mocks.sendTelegram.mockResolvedValue({ ok: false, error: 'fetch failed' } as any);

    const summary = await runExpiryReminders(db);

    expect(summary.expired).toMatchObject({ failed: 1 });
    expect(mocks.markReminderSent).not.toHaveBeenCalled();
  });

  it('T0: leaves the user unstamped when every channel failed', async () => {
    mocks.listExpired.mockResolvedValue([expiredRow()]);
    mocks.sendLifecycleEmail.mockResolvedValue({ ok: false, error: 'HTTP 500' } as any);

    const summary = await runExpiryReminders(db);

    expect(summary.expired).toMatchObject({ failed: 1 });
    expect(mocks.markReminderSent).not.toHaveBeenCalled();
  });
  // =========================================================================
  // T-3 branch: pre-charge notice vs manual-renewal reminder
  // =========================================================================

  const autoRenewingRow = (over: Record<string, unknown> = {}) =>
    expiringRow({ autoRenew: true, hasSavedPaymentMethod: true, ...over });

  it('T-3: an auto-renewing subscriber gets the PRE-CHARGE notice, not "продлите"', async () => {
    mocks.listExpiring.mockResolvedValue([autoRenewingRow()]);

    await runExpiryReminders(db);

    const sent = (mocks.sendLifecycleEmail.mock.calls[0] as any[])[0];
    expect(sent.textBody).toContain('спишем 990 ₽');
    expect(sent.textBody).toContain('отменить можно в настройках');
    expect(sent.subject).not.toContain('истекает');
  });

  it('T-3: quotes the LOCKED amount, not the plan list price', async () => {
    // Admin raised the tariff to 990 after this user subscribed at 490.
    mocks.fetchLastPaid.mockResolvedValue({ amountRub: 490, planId: 2 });
    mocks.listExpiring.mockResolvedValue([autoRenewingRow()]);

    await runExpiryReminders(db);

    const sent = (mocks.sendLifecycleEmail.mock.calls[0] as any[])[0];
    expect(sent.textBody).toContain('спишем 490 ₽');
    expect(sent.textBody).not.toContain('990');
  });

  it('T-3: auto_renew without a saved card still gets the manual reminder', async () => {
    mocks.listExpiring.mockResolvedValue([
      expiringRow({ autoRenew: true, hasSavedPaymentMethod: false }),
    ]);

    await runExpiryReminders(db);

    const sent = (mocks.sendLifecycleEmail.mock.calls[0] as any[])[0];
    expect(sent.subject).toContain('истекает');
  });

  it('T-3: a cancelled subscriber (auto_renew=false) still gets the manual reminder', async () => {
    mocks.listExpiring.mockResolvedValue([
      expiringRow({ autoRenew: false, hasSavedPaymentMethod: true }),
    ]);

    await runExpiryReminders(db);

    const sent = (mocks.sendLifecycleEmail.mock.calls[0] as any[])[0];
    expect(sent.subject).toContain('истекает');
  });

  it('T-3: the pre-charge branch still stamps the user exactly once', async () => {
    mocks.listExpiring.mockResolvedValue([autoRenewingRow()]);

    const summary = await runExpiryReminders(db);

    expect(summary.expiring).toMatchObject({ due: 1, emailSent: 1, failed: 0 });
    expect(mocks.markReminderSent).toHaveBeenCalledTimes(1);
  });

  // =========================================================================
  // ФЗ 376: the pre-charge notice may not be skipped for an auto-renewing
  // user just because they have no real email address.
  // =========================================================================

  it('T-3: TG-native auto-renewer (synthetic email) gets the pre-charge DM', async () => {
    mocks.listExpiring.mockResolvedValue([
      autoRenewingRow({ email: 'tg_55@bot.gptweb.ru', tgBotChatId: 55 }),
    ]);

    const summary = await runExpiryReminders(db);

    expect(mocks.sendLifecycleEmail).not.toHaveBeenCalled();
    expect(mocks.sendUpcomingChargeTg).toHaveBeenCalledWith(
      expect.objectContaining({ amountRub: 990, chatId: 55, planName: 'Pro' }),
    );
    expect(summary.expiring).toMatchObject({ tgSent: 1, skippedNoChannel: 0, failed: 0 });
    expect(mocks.markReminderSent).toHaveBeenCalledWith(db, 'u-expiring');
  });

  it('T-3: does NOT double-notify — no DM when the email went out', async () => {
    mocks.listExpiring.mockResolvedValue([autoRenewingRow({ tgBotChatId: 55 })]);

    await runExpiryReminders(db);

    expect(mocks.sendLifecycleEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendUpcomingChargeTg).not.toHaveBeenCalled();
  });

  it('T-3: falls back to the DM when the pre-charge email fails', async () => {
    mocks.listExpiring.mockResolvedValue([autoRenewingRow({ tgBotChatId: 55 })]);
    mocks.sendLifecycleEmail.mockResolvedValue({ ok: false, error: 'HTTP 503' } as any);

    const summary = await runExpiryReminders(db);

    expect(mocks.sendUpcomingChargeTg).toHaveBeenCalledTimes(1);
    expect(summary.expiring).toMatchObject({ emailSent: 0, tgSent: 1, failed: 0 });
    expect(mocks.markReminderSent).toHaveBeenCalledWith(db, 'u-expiring');
  });

  it('T-3: bot transiently down → left unstamped so the next tick retries', async () => {
    mocks.listExpiring.mockResolvedValue([
      autoRenewingRow({ email: 'tg_55@bot.gptweb.ru', tgBotChatId: 55 }),
    ]);
    mocks.sendUpcomingChargeTg.mockResolvedValue({ ok: false, error: 'fetch failed' } as any);

    const summary = await runExpiryReminders(db);

    expect(summary.expiring).toMatchObject({ failed: 1 });
    expect(mocks.markReminderSent).not.toHaveBeenCalled();
  });

  it('T-3: a NON-auto-renewing synthetic-email user is still just skipped', async () => {
    // The manual-renewal reminder is a courtesy, not a legal obligation —
    // no DM fallback, and nothing charges them either.
    mocks.listExpiring.mockResolvedValue([
      expiringRow({ email: 'tg_55@bot.gptweb.ru', tgBotChatId: 55 }),
    ]);

    const summary = await runExpiryReminders(db);

    expect(mocks.sendUpcomingChargeTg).not.toHaveBeenCalled();
    expect(summary.expiring).toMatchObject({ skippedNoChannel: 1 });
  });
});
