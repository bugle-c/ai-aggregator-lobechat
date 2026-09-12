import { serverDB } from '@lobechat/database';

import { userBilling } from '@/database/schemas';

const BOT_URL = process.env.BOT_INTERNAL_URL || 'http://127.0.0.1:8082';

interface TelegramLinkInput {
  isNewUser?: boolean;
  telegramId: number;
  userId: string;
  userName?: string;
}

/**
 * Fires from Better Auth's databaseHooks.account.create.after when
 * providerId === 'telegram' — i.e. on Telegram *authentication* via the
 * Login Widget. Both writes are best-effort — neither blocks auth.
 *
 * What this hook deliberately does NOT do (2026-09-12):
 *   - stamp `tg_bot_chat_id` — a login proves identity but creates no chat
 *     with @gptwebrubot; bots cannot DM a user who never pressed Start.
 *   - grant the +100 link bonus or referral payouts. Until 2026-09-12 it
 *     did, which paid 133 of 148 "linked" users who were unreachable
 *     (128 had only ever logged in via the widget). The bonus buys
 *     reachability, so it is granted where reachability is proven: in
 *     /api/billing/tg-link-confirm (deep-link /start) and in
 *     /api/billing/register-bot-chat (any real bot update). Both are
 *     idempotent, so a user who does both is paid once.
 *
 * The bot.db seed below stays: without it a later plain /start would make
 * the bot create a second lobechat account for the same Telegram id.
 */
export async function linkTelegramAccount(input: TelegramLinkInput): Promise<void> {
  // 1) lobechat side — ensure a user_billing row exists (planId 1).
  try {
    await serverDB
      .insert(userBilling)
      .values({ userId: input.userId, planId: 1 })
      .onConflictDoNothing({ target: userBilling.userId });
  } catch (e) {
    console.error('[tg-link] failed to ensure user_billing row', e);
  }

  // 2) gptwebrubot side — bot.db sqlite via internal HTTP route, so the
  //    bot maps this Telegram id to THIS account instead of minting a new one.
  const token = process.env.BOT_INTERNAL_TOKEN;
  if (!token) {
    console.warn('[tg-link] BOT_INTERNAL_TOKEN not set, skipping bot.db sync');
    return;
  }
  try {
    const res = await fetch(`${BOT_URL}/internal/link-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': token,
      },
      body: JSON.stringify({
        tg_user_id: input.telegramId,
        tg_chat_id: input.telegramId, // for private chats id === chat_id
        lobechat_user_id: input.userId,
        first_name: input.userName,
        source: input.isNewUser ? 'auth_signup' : 'auth_relink',
      }),
    });
    if (!res.ok) {
      console.error(
        '[tg-link] bot endpoint returned',
        res.status,
        await res.text().catch(() => ''),
      );
    }
  } catch (e) {
    console.error('[tg-link] bot link HTTP failed', e);
  }
}
