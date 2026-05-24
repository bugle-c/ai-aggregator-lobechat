import { serverDB } from '@lobechat/database';

import { userBilling } from '@/database/schemas';
import { grantTgLinkBonus } from '@/server/modules/billing/grant-tg-link-bonus';

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
        // No setWhere — we always want to overwrite. The previous
        // `eq(userBilling.tgBotChatId, input.telegramId)` was inverted
        // logic: it only updated when the row's tg_bot_chat_id was
        // ALREADY equal to the new value, so pre-existing rows with
        // NULL never got the link stamp. Pre-existing user_billing
        // rows can exist for email-signup users who only later link TG.
      });
  } catch (e) {
    console.error('[tg-link] failed to set tg_bot_chat_id', e);
  }

  // 1.5) Bonus grant — fires only on first-ever TG link per user.
  //      Best-effort. Idempotent: subsequent re-links are no-ops.
  try {
    const result = await grantTgLinkBonus(serverDB, input.userId);
    if (result.granted > 0) {
      console.info(
        '[tg-link] +' + result.granted + ' bonus credits granted to',
        input.userId,
        'expires',
        result.expiresAt,
      );
    }
  } catch (e) {
    console.error('[tg-link] grantTgLinkBonus failed', e);
  }

  // 1.6) Referral payouts — referee just linked TG, our anti-fraud gate.
  //      Flip any pending `referrals` rows to 'rewarded' and credit
  //      both L1/L2 referrers + the referee themselves.
  try {
    const { processReferralRewards } =
      await import('@/server/modules/referrals/processReferralRewards');
    const result = await processReferralRewards(serverDB, input.userId);
    if (result.awardedCount > 0) {
      console.info(
        `[tg-link] referral rewards: awarded=${result.awardedCount} total=${result.totalCredits}cr referee=${input.userId}`,
      );
    }
  } catch (e) {
    console.error('[tg-link] processReferralRewards failed', e);
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
