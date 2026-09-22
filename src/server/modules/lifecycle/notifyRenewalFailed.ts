/**
 * Decline notice for an OFF-SESSION renewal charge.
 *
 * Distinct from the checkout-recovery flow in
 * `/api/cron/payment-recovery-notify`: there the user opened a payment form
 * and walked away, so «вы не закончили оплату» is true. Here they did
 * nothing — we tried to take money from a card on file and the bank said no.
 * Sending them a recovery invoice was both confusing and wrong, so
 * payment-recovery-notify now skips `kind='auto_renew'` rows and this module
 * owns the messaging.
 *
 * Throttled to one notice per FAIL_NOTIFY_COOLDOWN_MS across the whole
 * dunning schedule (which retries daily for 3 days, then weekly out to +50d
 * — a notice per attempt would be ~10 emails). The stamp lives on the failed
 * payment row's metadata as `renew_failed_notified`.
 *
 * Never throws: a messaging failure must not abort the cron sweep.
 */
import { eq, sql } from 'drizzle-orm';

import { billingPayments } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';

import { sendLifecycleEmail } from './email';
import { isSyntheticEmail } from './expiringSubscriptions';
import { sendRenewalFailedTelegram } from './telegram';
import { buildRenewalFailedEmail } from './templates';

export const FAIL_NOTIFY_COOLDOWN_MS = 72 * 3_600_000;

export interface NotifyRenewalFailedInput {
  /** Amount the bank refused, in rubles. */
  amountRub: number;
  email: string | null;
  /** The `failed` billing_payments row this notice belongs to. */
  paymentRowId: string;
  planName: string;
  tgBotChatId: number | null;
  userId: string;
}

export async function notifyRenewalFailed(
  db: LobeChatDatabase,
  args: NotifyRenewalFailedInput,
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - FAIL_NOTIFY_COOLDOWN_MS);
    const recent = await db
      .select({ id: billingPayments.id })
      .from(billingPayments)
      .where(
        sql`${billingPayments.userId} = ${args.userId}
            AND ${billingPayments.metadata}->>'kind' = 'auto_renew'
            AND (${billingPayments.metadata}->>'renew_failed_notified')::timestamptz > ${since}`,
      )
      .limit(1);
    if (recent.length > 0) return false;

    let delivered = false;
    if (!isSyntheticEmail(args.email)) {
      const tpl = buildRenewalFailedEmail({ amountRub: args.amountRub, planName: args.planName });
      const sent = await sendLifecycleEmail({ to: args.email!, ...tpl });
      if (sent.ok) delivered = true;
      else console.error(`[renew] failure email failed for ${args.userId}: ${sent.error}`);
    }
    if (args.tgBotChatId != null) {
      const sent = await sendRenewalFailedTelegram({
        amountRub: args.amountRub,
        chatId: args.tgBotChatId,
        planName: args.planName,
      });
      if (sent.ok) delivered = true;
      else console.error(`[renew] failure DM failed for ${args.userId}: ${sent.error}`);
    }

    // Only stamp when something actually went out, so a transient Brevo/bot
    // outage retries on the next dunning tick instead of being swallowed.
    if (delivered) {
      await db
        .update(billingPayments)
        .set({
          metadata: sql`COALESCE(${billingPayments.metadata}, '{}'::jsonb) || ${JSON.stringify({
            renew_failed_notified: new Date().toISOString(),
          })}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(billingPayments.id, args.paymentRowId));
    }
    return delivered;
  } catch (err) {
    console.error('[renew] notifyRenewalFailed error:', err);
    return false;
  }
}
