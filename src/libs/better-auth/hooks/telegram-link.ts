import { serverDB } from '@lobechat/database';
import { eq } from 'drizzle-orm';

import { userBilling } from '@/database/schemas';

const BOT_URL = process.env.BOT_INTERNAL_URL || 'http://127.0.0.1:8082';

interface TelegramLinkInput {
  isNewUser?: boolean;
  telegramId: number;
  userId: string;
  userName?: string;
}

/**
 * Auto-link Telegram bot to a freshly-created user_account.
 * Fires from Better Auth's databaseHooks.account.create.after when
 * providerId === 'telegram'. Both writes are best-effort — neither
 * blocks auth on failure.
 */
export async function linkTelegramAccount(input: TelegramLinkInput): Promise<void> {
  // 1) lobechat side — user_billing.tg_bot_chat_id (bigint).
  //    Existing notify-bot-pending cron reads this column.
  try {
    await serverDB
      .insert(userBilling)
      .values({ userId: input.userId, tgBotChatId: input.telegramId, planId: 1 })
      .onConflictDoUpdate({
        target: userBilling.userId,
        set: { tgBotChatId: input.telegramId },
        setWhere: eq(userBilling.tgBotChatId, input.telegramId), // only update if changed
      });
  } catch (e) {
    console.error('[tg-link] failed to set tg_bot_chat_id', e);
  }

  // 2) gptwebrubot side — bot.db sqlite via internal HTTP route.
  //    Defined in Task 5; safe to call even if endpoint doesn't exist yet
  //    (catch handles connection errors / 404).
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
