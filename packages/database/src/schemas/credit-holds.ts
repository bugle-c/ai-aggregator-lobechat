import { index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { timestamptz } from './_helpers';
import { users } from './user';

/**
 * Credit holds — credits reserved before async generation runs.
 *
 * Design (Pkg2 — pre-charge architecture):
 *
 * - `chargeBeforeGenerate` inserts a hold for the worst-case credit cost of
 *   an image/video request, atomically with `incrementTokensUsed(... limit)`
 *   so concurrent requests can't pierce the user's monthly budget.
 *
 * - `chargeAfterGenerate` reconciles: it computes the *actual* cost from the
 *   provider's reported usage, then writes the diff against the hold, marks
 *   the hold released, and writes the usage_log row — all in one transaction.
 *
 * - On error / failed generation: the hold's full amount is refunded
 *   (incrementTokensUsed(-amount)) and `releasedAt` is set so the hold is
 *   no longer "active".
 *
 * - `released_at IS NULL` means the hold is still active (request in flight).
 *   The active partial index is the canonical place to look up "what does
 *   this user currently have reserved".
 */
export const creditHolds = pgTable(
  'credit_holds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Credits reserved (worst-case upper bound for the request). */
    amount: integer('amount').notNull(),
    /** Foreign key to async_tasks.id — the generation this hold is for. */
    asyncTaskId: uuid('async_task_id'),
    /** Free-form reason: 'image-gen', 'video-gen'. */
    reason: text('reason'),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
    /** Null = active hold. Set when reconciled or refunded. */
    releasedAt: timestamptz('released_at'),
  },
  (t) => [
    index('credit_holds_user_idx').on(t.userId),
    index('credit_holds_async_task_idx').on(t.asyncTaskId),
    index('credit_holds_active_idx').on(t.userId, t.releasedAt),
  ],
);

export type CreditHoldItem = typeof creditHolds.$inferSelect;
export type NewCreditHold = typeof creditHolds.$inferInsert;
