/**
 * Orchestrator behind `/api/cron/expiry-reminders`.
 *
 *   T-3 leg — email «подписка истекает через 3 дня». Telegram for this leg
 *             is already covered by `expireSubscriptions.flagExpiringSubscriptions`
 *             (T-4, delivered by notify-bot-pending), so we don't double-DM.
 *   T0  leg — email «тариф закончился» + Telegram DM where a bot chat exists.
 *
 * Cheap by construction: two indexed SELECTs, then `return` when both are
 * empty. No LLM, no paid API besides the Brevo send itself. A user is
 * stamped (`markReminderSent`) once at least one channel delivered, or when
 * there is no channel to try (synthetic email, no bot chat) — so a
 * transient Brevo/bot failure retries on the next tick, while a user we
 * cannot reach is not re-selected every 6 hours.
 */
import { type LobeChatDatabase } from '@/database/type';

import { sendLifecycleEmail } from './email';
import {
  isSyntheticEmail,
  listExpiredSubscriptions,
  listExpiringSubscriptions,
  markReminderSent,
} from './expiringSubscriptions';
import { sendSubscriptionExpiredTelegram } from './telegram';
import { buildExpiryReminderEmail, buildSubscriptionExpiredEmail } from './templates';

export interface LegSummary {
  due: number;
  emailSent: number;
  failed: number;
  skippedNoChannel: number;
  tgSent: number;
}

export interface ExpiryReminderSummary {
  expired: LegSummary;
  expiring: LegSummary;
}

const emptyLeg = (): LegSummary => ({
  due: 0,
  emailSent: 0,
  failed: 0,
  skippedNoChannel: 0,
  tgSent: 0,
});

export async function runExpiryReminders(db: LobeChatDatabase): Promise<ExpiryReminderSummary> {
  const summary: ExpiryReminderSummary = { expired: emptyLeg(), expiring: emptyLeg() };

  const [expiring, expired] = await Promise.all([
    listExpiringSubscriptions(db),
    listExpiredSubscriptions(db),
  ]);
  summary.expiring.due = expiring.length;
  summary.expired.due = expired.length;
  if (expiring.length === 0 && expired.length === 0) return summary;

  // ---- T-3: email only ----
  for (const row of expiring) {
    const leg = summary.expiring;
    if (isSyntheticEmail(row.email)) {
      leg.skippedNoChannel++;
      await markReminderSent(db, row.userId);
      continue;
    }
    const tpl = buildExpiryReminderEmail({
      expiresAt: row.subscriptionExpiresAt,
      planName: row.planName,
    });
    const sent = await sendLifecycleEmail({ to: row.email!, ...tpl });
    if (sent.ok) {
      leg.emailSent++;
      await markReminderSent(db, row.userId);
    } else {
      leg.failed++;
      console.error(`[expiry-reminders] T-3 email failed for ${row.userId}: ${sent.error}`);
    }
  }

  // ---- T0: email + Telegram ----
  for (const row of expired) {
    const leg = summary.expired;
    const hasEmail = !isSyntheticEmail(row.email);
    const hasTg = row.tgBotChatId != null;
    if (!hasEmail && !hasTg) {
      leg.skippedNoChannel++;
      await markReminderSent(db, row.userId);
      continue;
    }

    let delivered = false;
    if (hasEmail) {
      const tpl = buildSubscriptionExpiredEmail({
        expiredAt: row.expiredAt,
        planName: row.planName,
      });
      const sent = await sendLifecycleEmail({ to: row.email!, ...tpl });
      if (sent.ok) {
        leg.emailSent++;
        delivered = true;
      } else {
        console.error(`[expiry-reminders] T0 email failed for ${row.userId}: ${sent.error}`);
      }
    }
    if (hasTg) {
      const sent = await sendSubscriptionExpiredTelegram({
        chatId: row.tgBotChatId!,
        expiredAt: row.expiredAt,
        planName: row.planName,
      });
      if (sent.ok) {
        leg.tgSent++;
        delivered = true;
      } else {
        console.error(`[expiry-reminders] T0 telegram failed for ${row.userId}: ${sent.error}`);
      }
    }

    if (delivered) {
      await markReminderSent(db, row.userId);
    } else {
      leg.failed++;
    }
  }

  return summary;
}
