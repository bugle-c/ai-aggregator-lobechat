import type { InferSelectModel } from 'drizzle-orm';

import type { userBilling } from '@/database/schemas';

type UserBillingRow = Pick<
  InferSelectModel<typeof userBilling>,
  'bonusBalance' | 'bonusBalanceExpiresAt'
>;

/**
 * Return the bonus credit amount currently counting toward
 * totalAvailable. Returns 0 if no bonus, balance is zero, or expired.
 *
 * Centralised so every cap-computation site uses the same logic.
 */
export function activeBonusFor(row: UserBillingRow | null | undefined): number {
  if (!row) return 0;
  if (!row.bonusBalance || row.bonusBalance <= 0) return 0;
  if (!row.bonusBalanceExpiresAt) return 0;
  if (new Date(row.bonusBalanceExpiresAt).getTime() <= Date.now()) return 0;
  return row.bonusBalance;
}
