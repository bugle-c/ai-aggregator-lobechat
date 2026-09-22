/**
 * Written confirmation of a subscription refusal — ФЗ от 15.10.2025 № 376-ФЗ
 * (ст. 16.1 ЗПП).
 *
 * The law wants the refusal confirmed IN WRITING, stating that no further
 * charges will occur. An on-screen toast is not that: it is gone the moment
 * the user navigates away and leaves no trace on their side. So every
 * `cancelSubscription` also pushes a confirmation into whatever durable
 * channel the user actually has — email, Telegram, or both.
 *
 * Mirrors `notifyRenewalFailed`: both channels are tried, neither is fatal,
 * and the caller only learns what got delivered.
 *
 * Never throws — a refusal must succeed even when Brevo and the bot are down.
 */
import { eq } from 'drizzle-orm';

import { userBilling, users } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';

import { sendLifecycleEmail } from './email';
import { isSyntheticEmail } from './expiringSubscriptions';
import { sendCancellationConfirmedTelegram } from './telegram';
import { buildCancellationConfirmedEmail } from './templates';

export interface CancellationConfirmationResult {
  email: boolean;
  telegram: boolean;
}

export async function notifySubscriptionCancelled(
  db: LobeChatDatabase,
  args: {
    activeUntil: Date | null;
    planName: string;
    userId: string;
  },
): Promise<CancellationConfirmationResult> {
  const result: CancellationConfirmationResult = { email: false, telegram: false };

  try {
    const [row] = await db
      .select({ email: users.email, tgBotChatId: userBilling.tgBotChatId })
      .from(users)
      .leftJoin(userBilling, eq(userBilling.userId, users.id))
      .where(eq(users.id, args.userId))
      .limit(1);

    if (!isSyntheticEmail(row?.email)) {
      const tpl = buildCancellationConfirmedEmail({
        activeUntil: args.activeUntil,
        planName: args.planName,
      });
      const sent = await sendLifecycleEmail({ to: row!.email!, ...tpl });
      if (sent.ok) result.email = true;
      else console.error(`[cancel] confirmation email failed for ${args.userId}: ${sent.error}`);
    }

    if (row?.tgBotChatId != null) {
      const sent = await sendCancellationConfirmedTelegram({
        activeUntil: args.activeUntil,
        chatId: row.tgBotChatId,
        planName: args.planName,
      });
      if (sent.ok) result.telegram = true;
      else console.error(`[cancel] confirmation DM failed for ${args.userId}: ${sent.error}`);
    }
  } catch (err) {
    console.error('[cancel] notifySubscriptionCancelled error:', err);
  }

  return result;
}
