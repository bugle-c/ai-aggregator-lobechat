import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/server';

import { POST } from '../route';

vi.mock('@/database/server', () => ({ getServerDB: vi.fn() }));
vi.mock('@/database/schemas', () => ({ userBilling: { userId: 'user_id' } }));

const grantTgLinkBonus = vi.fn();
const processReferralRewards = vi.fn();
vi.mock('@/server/modules/billing/grant-tg-link-bonus', () => ({
  grantTgLinkBonus: (...a: any[]) => grantTgLinkBonus(...a),
}));
vi.mock('@/server/modules/referrals/processReferralRewards', () => ({
  processReferralRewards: (...a: any[]) => processReferralRewards(...a),
}));

const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
const execute = vi.fn();
const dbMock = { execute, insert: vi.fn().mockReturnValue({ values }) };

const req = (body: unknown, token: string | null = 'tok') =>
  new Request('http://x/api/billing/register-bot-chat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-internal-token': token } : {}),
    },
    body: JSON.stringify(body),
  });

describe('POST /api/billing/register-bot-chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BOT_INTERNAL_TOKEN = 'tok';
    (getServerDB as any).mockResolvedValue(dbMock);
    grantTgLinkBonus.mockResolvedValue({ granted: 100, alreadyClaimed: false });
    processReferralRewards.mockResolvedValue({ awardedCount: 1, totalCredits: 200 });
  });

  it('401 without the shared token', async () => {
    const res = await POST(req({ tg_user_id: 1, tg_chat_id: 1 }, null));
    expect(res.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it('stamps the real chat_id, then pays the link bonus and referral rewards (reachability proven)', async () => {
    execute.mockResolvedValueOnce({ rows: [{ user_id: 'u1' }] });
    const res = await POST(req({ tg_user_id: 42, tg_chat_id: 42 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, linked: true, granted: 100 });

    expect(values).toHaveBeenCalledWith({ planId: 1, tgBotChatId: 42, userId: 'u1' });
    expect(grantTgLinkBonus).toHaveBeenCalledWith(dbMock, 'u1');
    expect(processReferralRewards).toHaveBeenCalledWith(dbMock, 'u1');
  });

  it('is a no-op for a Telegram id with no web account — nothing stamped, nothing paid', async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    const res = await POST(req({ tg_user_id: 99, tg_chat_id: 99 }));
    expect(await res.json()).toEqual({ ok: true, linked: false, reason: 'no_account' });
    expect(values).not.toHaveBeenCalled();
    expect(grantTgLinkBonus).not.toHaveBeenCalled();
    expect(processReferralRewards).not.toHaveBeenCalled();
  });

  it('bot-native account (no telegram accounts row, bot passes its own user id): stamps chat_id, pays nothing', async () => {
    execute
      .mockResolvedValueOnce({ rows: [] }) // accounts lookup → none
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // users exists
    const res = await POST(req({ tg_user_id: 77, tg_chat_id: 77, lobechat_user_id: 'bot-u7' }));
    expect(await res.json()).toEqual({ ok: true, linked: false, reason: 'bot_native', granted: 0 });
    expect(values).toHaveBeenCalledWith({ planId: 1, tgBotChatId: 77, userId: 'bot-u7' });
    expect(grantTgLinkBonus).not.toHaveBeenCalled();
    expect(processReferralRewards).not.toHaveBeenCalled();
  });

  it('ignores a bot-provided user id that does not exist in users', async () => {
    execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const res = await POST(req({ tg_user_id: 78, tg_chat_id: 78, lobechat_user_id: 'ghost' }));
    expect(await res.json()).toEqual({ ok: true, linked: false, reason: 'no_account' });
    expect(values).not.toHaveBeenCalled();
  });

  it('still returns linked:true when the bonus grant throws (stamp is the important side effect)', async () => {
    execute.mockResolvedValueOnce({ rows: [{ user_id: 'u1' }] });
    grantTgLinkBonus.mockRejectedValueOnce(new Error('db down'));
    const res = await POST(req({ tg_user_id: 42, tg_chat_id: 42 }));
    expect(await res.json()).toEqual({ ok: true, linked: true, granted: 0 });
    expect(processReferralRewards).toHaveBeenCalledWith(dbMock, 'u1');
  });
});
