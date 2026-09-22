import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notifySubscriptionCancelled } from '../notifySubscriptionCancelled';

const mocks = vi.hoisted(() => ({
  sendLifecycleEmail: vi.fn(async () => ({ ok: true, messageId: 'm' })),
  sendTelegram: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../email', () => ({ sendLifecycleEmail: mocks.sendLifecycleEmail }));
vi.mock('../telegram', () => ({ sendCancellationConfirmedTelegram: mocks.sendTelegram }));

/** Minimal drizzle-select stub: select().from().leftJoin().where().limit(). */
const dbWith = (row: unknown) =>
  ({
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({ limit: async () => (row ? [row] : []) }),
        }),
      }),
    }),
  }) as any;

const ACTIVE_UNTIL = new Date('2026-10-20T00:00:00Z');

describe('notifySubscriptionCancelled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendLifecycleEmail.mockResolvedValue({ ok: true, messageId: 'm' });
    mocks.sendTelegram.mockResolvedValue({ ok: true });
  });

  it('emails the written confirmation: no further charges, card deleted', async () => {
    const db = dbWith({ email: 'real@example.com', tgBotChatId: null });

    const res = await notifySubscriptionCancelled(db, {
      activeUntil: ACTIVE_UNTIL,
      planName: 'Pro',
      userId: 'u1',
    });

    expect(res).toEqual({ email: true, telegram: false });
    const sent = (mocks.sendLifecycleEmail.mock.calls[0] as any[])[0];
    expect(sent.to).toBe('real@example.com');
    expect(sent.subject).toContain('списаний больше не будет');
    expect(sent.textBody).toContain('Сохранённая карта удалена');
    expect(sent.textBody).toContain('20 октября 2026');
  });

  it('reaches TG-native users whose email is synthetic', async () => {
    const db = dbWith({ email: 'tg_7@bot.gptweb.ru', tgBotChatId: 7 });

    const res = await notifySubscriptionCancelled(db, {
      activeUntil: ACTIVE_UNTIL,
      planName: 'Pro',
      userId: 'u1',
    });

    expect(mocks.sendLifecycleEmail).not.toHaveBeenCalled();
    expect(mocks.sendTelegram).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 7, planName: 'Pro' }),
    );
    expect(res).toEqual({ email: false, telegram: true });
  });

  it('uses both channels when both exist', async () => {
    const db = dbWith({ email: 'real@example.com', tgBotChatId: 9 });

    expect(
      await notifySubscriptionCancelled(db, {
        activeUntil: ACTIVE_UNTIL,
        planName: 'Pro',
        userId: 'u1',
      }),
    ).toEqual({ email: true, telegram: true });
  });

  it('never throws when every channel fails — the refusal itself must stand', async () => {
    mocks.sendLifecycleEmail.mockResolvedValue({ ok: false, error: 'HTTP 500' } as any);
    mocks.sendTelegram.mockResolvedValue({ ok: false, error: 'blocked' } as any);
    const db = dbWith({ email: 'real@example.com', tgBotChatId: 9 });

    expect(
      await notifySubscriptionCancelled(db, {
        activeUntil: ACTIVE_UNTIL,
        planName: 'Pro',
        userId: 'u1',
      }),
    ).toEqual({ email: false, telegram: false });
  });

  it('never throws when the lookup itself blows up', async () => {
    const db = {
      select: () => {
        throw new Error('db down');
      },
    } as any;

    expect(
      await notifySubscriptionCancelled(db, {
        activeUntil: null,
        planName: 'Pro',
        userId: 'u1',
      }),
    ).toEqual({ email: false, telegram: false });
  });
});
