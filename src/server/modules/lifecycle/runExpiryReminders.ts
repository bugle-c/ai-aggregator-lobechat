/**
 * Orchestrator behind `/api/cron/expiry-reminders`.
 *
 *   T-3 leg — email, Telegram as a fallback. Branches on whether the card is
 *             on file: auto-renewing subscribers get the pre-charge notice
 *             («{дата} спишем {N} ₽»), everyone else the «истекает через 3
 *             дня, продлите» reminder.
 *             The pre-charge notice is a legal obligation (ФЗ 376 / ст. 16.1
 *             ЗПП), so a TG-native subscriber whose email is synthetic gets
 *             it by bot DM instead — email-only meant that cohort was
 *             charged with no notice at all. The DM fires ONLY when the
 *             email did not go out; `flagExpiringSubscriptions` already DMs
 *             everyone with a bot chat at T-4 (that one now branches on
 *             auto-renewal too — see the bot's `subscription_expiring`
 *             formatter), so an unconditional DM here would double-notify.
 *             A subscriber with NEITHER channel is not charged at all — see
 *             `hasPreChargeChannel` and the renew cron's guard.
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
import {
  fetchLastSubscriptionPayment,
  resolveRenewalAmount,
} from '@/server/modules/billing/renewalAmount';

import { sendLifecycleEmail } from './email';
import {
  isAutoRenewing,
  isSyntheticEmail,
  listExpiredSubscriptions,
  listExpiringSubscriptions,
  markReminderSent,
} from './expiringSubscriptions';
import { sendSubscriptionExpiredTelegram, sendUpcomingChargeTelegram } from './telegram';
import {
  buildExpiryReminderEmail,
  buildSubscriptionExpiredEmail,
  buildUpcomingChargeEmail,
} from './templates';

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

  // ---- T-3: email, with a Telegram fallback for the pre-charge notice ----
  for (const row of expiring) {
    const leg = summary.expiring;
    const autoRenewing = isAutoRenewing(row);
    const hasEmail = !isSyntheticEmail(row.email);
    // The manual-renewal reminder is a courtesy — no channel, no reminder.
    // The PRE-CHARGE notice is a legal obligation (ФЗ 376): if we have no
    // email we must still try the bot, and if we have neither channel the
    // renew cron refuses the charge (hasPreChargeChannel).
    const hasTg = autoRenewing && row.tgBotChatId != null;
    if (!hasEmail && !hasTg) {
      leg.skippedNoChannel++;
      await markReminderSent(db, row.userId);
      continue;
    }

    // Two different facts, two different notices. A subscriber with a card on
    // file is not about to lose access — we are about to take their money,
    // and that is what the notice has to say (and for how much). Telling
    // them to "продлить" was both wrong and the thing the public FAQ used to
    // promise instead of auto-renewal.
    const amountRub = autoRenewing
      ? resolveRenewalAmount(
          await fetchLastSubscriptionPayment(db, row.userId),
          row.planId,
          row.planPriceRub,
        )
      : row.planPriceRub;

    let delivered = false;
    let retryable = false;

    if (hasEmail) {
      const tpl = autoRenewing
        ? buildUpcomingChargeEmail({
            amountRub,
            chargeAt: row.subscriptionExpiresAt,
            planName: row.planName,
          })
        : buildExpiryReminderEmail({
            expiresAt: row.subscriptionExpiresAt,
            planName: row.planName,
          });
      const sent = await sendLifecycleEmail({ to: row.email!, ...tpl });
      if (sent.ok) {
        leg.emailSent++;
        delivered = true;
      } else {
        retryable = true;
        console.error(`[expiry-reminders] T-3 email failed for ${row.userId}: ${sent.error}`);
      }
    }

    // Bot DM only when the mandatory notice would otherwise not go out —
    // `flagExpiringSubscriptions` already DMs everyone at T-4, so sending
    // here as well for users who got the email would double-notify.
    if (hasTg && !delivered) {
      const sent = await sendUpcomingChargeTelegram({
        amountRub,
        chargeAt: row.subscriptionExpiresAt,
        chatId: row.tgBotChatId!,
        planName: row.planName,
      });
      if (sent.ok) {
        leg.tgSent++;
        delivered = true;
      } else {
        if (!sent.permanent) retryable = true;
        console.error(`[expiry-reminders] T-3 telegram failed for ${row.userId}: ${sent.error}`);
      }
    }

    if (delivered || !retryable) {
      if (!delivered) leg.skippedNoChannel++;
      await markReminderSent(db, row.userId);
    } else {
      leg.failed++;
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
    // A channel that failed for a transient reason (Brevo 5xx, bot down)
    // keeps the user unstamped so the next tick retries. A permanently
    // unreachable chat (blocked / deactivated) is just "no channel".
    let retryable = false;
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
        retryable = true;
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
        if (!sent.permanent) retryable = true;
        console.error(`[expiry-reminders] T0 telegram failed for ${row.userId}: ${sent.error}`);
      }
    }

    if (delivered || !retryable) {
      if (!delivered) leg.skippedNoChannel++;
      await markReminderSent(db, row.userId);
    } else {
      leg.failed++;
    }
  }

  return summary;
}
