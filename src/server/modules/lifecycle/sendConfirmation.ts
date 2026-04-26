/**
 * Phase 2.3 — Subscription confirmation email after a successful payment.
 *
 * Called from `fulfillPayment` after the plan + expires_at have been written.
 * NEVER throws — wraps all I/O in try/catch and returns a result object so a
 * failed email never breaks payment fulfillment.
 */
import { eq } from 'drizzle-orm';

import { users } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';

import { sendLifecycleEmail } from './email';
import { buildSubscriptionConfirmationEmail } from './templates';

export interface SendSubscriptionConfirmationInput {
  /** Credit grant from the plan (planTokenLimit for monthly subscription). */
  creditAmount: number;
  expiresAt: Date | null;
  planName: string;
  userId: string;
}

export async function sendSubscriptionConfirmation(
  db: LobeChatDatabase,
  input: SendSubscriptionConfirmationInput,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const userRow = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    const email = userRow[0]?.email;
    if (!email) {
      console.warn(`[lifecycle/confirmation] user ${input.userId} has no email, skipping`);
      return { ok: false, reason: 'no_email' };
    }

    const { subject, html, textBody } = buildSubscriptionConfirmationEmail({
      planName: input.planName,
      expiresAt: input.expiresAt,
      creditAmount: input.creditAmount,
    });

    const result = await sendLifecycleEmail({ to: email, subject, html, textBody });
    if (!result.ok) {
      console.error(`[lifecycle/confirmation] send failed for ${input.userId}: ${result.error}`);
      return { ok: false, reason: result.error };
    }
    console.info(
      `[lifecycle/confirmation] sent to ${input.userId} (${email}) plan=${input.planName}`,
    );
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[lifecycle/confirmation] unexpected error:', msg);
    return { ok: false, reason: msg };
  }
}
