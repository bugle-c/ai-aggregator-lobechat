import { beforeEach, describe, expect, it, vi } from 'vitest';

const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
const values = vi.fn().mockReturnValue({ onConflictDoNothing });
const insert = vi.fn().mockReturnValue({ values });

vi.mock('@lobechat/database', () => ({ serverDB: { insert: (...a: any[]) => insert(...a) } }));
vi.mock('@/database/schemas', () => ({ userBilling: { userId: 'user_id' } }));

const grantTgLinkBonus = vi.fn();
const processReferralRewards = vi.fn();
vi.mock('@/server/modules/billing/grant-tg-link-bonus', () => ({
  grantTgLinkBonus: (...a: any[]) => grantTgLinkBonus(...a),
}));
vi.mock('@/server/modules/referrals/processReferralRewards', () => ({
  processReferralRewards: (...a: any[]) => processReferralRewards(...a),
}));

describe('linkTelegramAccount (Telegram login hook)', () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    process.env.BOT_INTERNAL_TOKEN = 'tok';
    process.env.BOT_INTERNAL_URL = 'http://bot.test:8082';
  });

  it('ensures a billing row and seeds bot.db, but pays NO bonus and NO referrals on a mere login', async () => {
    const { linkTelegramAccount } = await import('../telegram-link');
    await linkTelegramAccount({ userId: 'u1', telegramId: 42, isNewUser: true, userName: 'P' });

    // billing row ensured (idempotent insert)
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith({ userId: 'u1', planId: 1 });

    // bot.db seed so a later /start maps to this account
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://bot.test:8082/internal/link-user');
    expect(JSON.parse(init.body)).toMatchObject({
      tg_user_id: 42,
      tg_chat_id: 42,
      lobechat_user_id: 'u1',
      source: 'auth_signup',
    });

    // The point of the 2026-09-12 change: a login proves identity, not
    // reachability — nothing is paid here.
    expect(grantTgLinkBonus).not.toHaveBeenCalled();
    expect(processReferralRewards).not.toHaveBeenCalled();
  });

  it('never throws into auth when the bot is down', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const { linkTelegramAccount } = await import('../telegram-link');
    await expect(
      linkTelegramAccount({ userId: 'u2', telegramId: 7, isNewUser: false }),
    ).resolves.toBeUndefined();
    expect(grantTgLinkBonus).not.toHaveBeenCalled();
  });
});
