/**
 * ФЗ от 15.10.2025 № 376-ФЗ (ст. 16.1 ЗПП) — what "refusal" means in columns,
 * and the one gate that decides whether a stored card may be charged.
 *
 * The law does not say "stop the cron"; it says stop USING the payment
 * details. `auto_renew = false` alone left a live YooKassa token sitting on
 * the row, one query change away from being charged again — so a refusal
 * NULLs `payment_method_id` too. Re-subscribing simply saves a fresh token
 * on the new checkout (fulfill.ts), so nothing is lost by dropping it.
 *
 * Pure builders + a pure predicate, so the guarantee is unit-testable
 * instead of living inside a tRPC procedure and a SQL where-clause.
 */
import { hasPreChargeChannel } from '@/server/modules/lifecycle/expiringSubscriptions';

export interface RefusalPatch {
  autoRenew: false;
  cancelledAt: Date;
  cancelReasonCode: string;
  paymentMethodId: null;
}

export interface CardRemovalPatch {
  autoRenew: false;
  paymentMethodId: null;
}

/**
 * User refused the subscription («Отменить подписку»). Access is untouched —
 * `subscription_expires_at` stays exactly as it was, they keep what they paid
 * for — but auto-renewal is off and the card token is gone.
 */
export function buildSubscriptionRefusalPatch(args: {
  now?: Date;
  reasonCode: string;
}): RefusalPatch {
  return {
    autoRenew: false,
    cancelReasonCode: args.reasonCode,
    cancelledAt: args.now ?? new Date(),
    paymentMethodId: null,
  };
}

/**
 * User removed only the saved card («Удалить карту»). Not a cancellation:
 * `cancelled_at` stays null so the plan card keeps reading "active", but the
 * token is gone and auto-renewal is off, so nothing can be charged.
 */
export function buildCardRemovalPatch(): CardRemovalPatch {
  return { autoRenew: false, paymentMethodId: null };
}

export interface ChargeGateRow {
  autoRenew: boolean;
  cancelledAt: Date | null;
  email: string | null;
  paymentMethodId: string | null;
  tgBotChatId: number | null;
}

/**
 * May `renew-due-subscriptions` charge this row's stored card?
 *
 * Four independent conditions, any one of which forbids the charge:
 *   1. auto-renewal is off;
 *   2. there is no token (removed, or never saved);
 *   3. the user has refused — using the details afterwards is what the law
 *      forbids, so even a leftover token must not be used;
 *   4. there is no channel the mandatory ≥3-day pre-charge notice could have
 *      reached (synthetic email AND no bot chat). We skip the charge rather
 *      than charge and show an in-app banner: a banner is not a notice sent
 *      three days *before* the debit, we cannot prove the user ever saw it,
 *      and an unlawful charge costs a refund plus a fine while a skipped one
 *      costs a cycle of MRR from a handful of accounts. Those users keep
 *      access to `subscription_expires_at` and can re-subscribe by hand.
 */
export function canAutoChargeStoredMethod(row: ChargeGateRow): boolean {
  if (!row.autoRenew) return false;
  if (!row.paymentMethodId) return false;
  if (row.cancelledAt) return false;
  return hasPreChargeChannel(row);
}
