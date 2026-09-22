import { afterEach, describe, expect, it, vi } from 'vitest';

import { notifyRenewalFailed } from '../notifyRenewalFailed';

const mocks = vi.hoisted(() => ({
  sendLifecycleEmail: vi.fn(async () => ({ ok: true, messageId: 'm' }) as any),
  sendRenewalFailedTelegram: vi.fn(async () => ({ ok: true }) as any),
}));

vi.mock('../email', () => ({ sendLifecycleEmail: mocks.sendLifecycleEmail }));
vi.mock('../telegram', () => ({ sendRenewalFailedTelegram: mocks.sendRenewalFailedTelegram }));

/** Mock db: `recent` drives the throttle query, updates are captured. */
function makeDb(recent: any[] = []) {
  const updates: any[] = [];
  return {
    _updates: updates,
    select: () => ({ from: () => ({ where: () => ({ limit: async () => recent }) }) }),
    update: () => ({
      set: (setArgs: any) => {
        updates.push(setArgs);
        return { where: async () => undefined };
      },
    }),
  } as any;
}

const base = {
  amountRub: 490,
  email: 'real@example.com',
  paymentRowId: 'pay-1',
  planName: 'Pro',
  tgBotChatId: null as number | null,
  userId: 'u-1',
};

describe('notifyRenewalFailed', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.sendLifecycleEmail.mockResolvedValue({ ok: true, messageId: 'm' } as any);
    mocks.sendRenewalFailedTelegram.mockResolvedValue({ ok: true } as any);
  });

  it('emails the card-update notice and stamps the payment row', async () => {
    const db = makeDb();
    const delivered = await notifyRenewalFailed(db, base);

    expect(delivered).toBe(true);
    expect(mocks.sendLifecycleEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Не удалось продлить подписку'),
        to: 'real@example.com',
      }),
    );
    expect(db._updates).toHaveLength(1);
  });

  it('also DMs when a bot chat exists', async () => {
    const db = makeDb();
    await notifyRenewalFailed(db, { ...base, tgBotChatId: 12_345 });

    expect(mocks.sendRenewalFailedTelegram).toHaveBeenCalledWith(
      expect.objectContaining({ amountRub: 490, chatId: 12_345, planName: 'Pro' }),
    );
  });

  it('is throttled — a recent notice suppresses the next dunning attempt', async () => {
    const db = makeDb([{ id: 'already-notified' }]);
    const delivered = await notifyRenewalFailed(db, base);

    expect(delivered).toBe(false);
    expect(mocks.sendLifecycleEmail).not.toHaveBeenCalled();
    expect(mocks.sendRenewalFailedTelegram).not.toHaveBeenCalled();
    expect(db._updates).toHaveLength(0);
  });

  it('skips a synthetic (telegram-minted) email address', async () => {
    const db = makeDb();
    const delivered = await notifyRenewalFailed(db, {
      ...base,
      email: 'tg_1@bot.gptweb.ru',
    });

    expect(mocks.sendLifecycleEmail).not.toHaveBeenCalled();
    expect(delivered).toBe(false);
    expect(db._updates).toHaveLength(0);
  });

  it('does NOT stamp when every channel failed, so the next tick retries', async () => {
    mocks.sendLifecycleEmail.mockResolvedValue({ ok: false, error: 'brevo 500' } as any);
    const db = makeDb();

    const delivered = await notifyRenewalFailed(db, base);

    expect(delivered).toBe(false);
    expect(db._updates).toHaveLength(0);
  });

  it('counts the send as delivered when only Telegram worked', async () => {
    mocks.sendLifecycleEmail.mockResolvedValue({ ok: false, error: 'brevo 500' } as any);
    const db = makeDb();

    const delivered = await notifyRenewalFailed(db, { ...base, tgBotChatId: 777 });

    expect(delivered).toBe(true);
    expect(db._updates).toHaveLength(1);
  });

  it('never throws — a db failure is swallowed so the cron sweep continues', async () => {
    const db = {
      select: () => {
        throw new Error('db down');
      },
    } as any;

    await expect(notifyRenewalFailed(db, base)).resolves.toBe(false);
  });
});
