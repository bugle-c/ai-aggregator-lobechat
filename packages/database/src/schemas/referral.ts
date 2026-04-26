import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamptz } from './_helpers';
import { users } from './user';

// ============ Referrals ============ //
// Each successful referred signup creates ONE row at level=1 and (if a
// grand-parent referrer exists) ONE row at level=2. Both start as 'pending'.
// On first SUCCESSFUL billing payment of `referred_user_id`, the matching
// rows flip to 'rewarded' and credit_awarded gets populated. Subsequent
// payments do NOT trigger additional rewards.
export const referrals = pgTable(
  'referrals',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    referrerUserId: text('referrer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    referredUserId: text('referred_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 1 = direct referral, 2 = grand-parent. */
    level: smallint('level').notNull(),
    /**
     * 'pending'             — waiting for referred user's first payment.
     * 'rewarded'            — referrer credited.
     * 'rejected_abuse'      — flagged by anti-abuse rules at signup or admin override.
     * 'rejected_no_payment' — referred user never paid (e.g. account closed). Reserved.
     */
    status: text('status').default('pending').notNull(),
    creditsAwarded: integer('credits_awarded').default(0),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
    rewardedAt: timestamptz('rewarded_at'),
  },
  (table) => [
    check('referrals_level_check', sql`${table.level} IN (1, 2)`),
    check(
      'referrals_status_check',
      sql`${table.status} IN ('pending', 'rewarded', 'rejected_abuse', 'rejected_no_payment')`,
    ),
    unique('referrals_unique_referrer_referred_level').on(
      table.referrerUserId,
      table.referredUserId,
      table.level,
    ),
    index('referrals_status_idx').on(table.status),
    index('referrals_referrer_idx').on(table.referrerUserId),
    index('referrals_referred_idx').on(table.referredUserId),
  ],
);

export type ReferralItem = typeof referrals.$inferSelect;
export type NewReferral = typeof referrals.$inferInsert;

// ============ Cashout Requests ============ //
// Manual cashout queue. User submits a request with bank details; admin
// processes via YooKassa Личный кабинет or other off-platform rail and
// flips status to 'paid'. On reject, credits get refunded back to the
// user's token balance.
export const cashoutRequests = pgTable(
  'cashout_requests',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Credits the user wants to convert to RUB. Must be ≥ 5000. */
    creditsRequested: integer('credits_requested').notNull(),
    /** RUB per credit at request time (locks rate against future changes). */
    rateRubPerCredit: numeric('rate_rub_per_credit', { precision: 8, scale: 4 })
      .default('0.05')
      .notNull(),
    /** Denormalized payout amount in RUB (creditsRequested × rateRubPerCredit, rounded). */
    amountRub: integer('amount_rub').notNull(),
    /**
     * 'pending'  — credits already deducted, awaiting admin review.
     * 'approved' — admin has reviewed but not yet paid out.
     * 'paid'     — admin marked as paid; processedAt + processedBy populated.
     * 'rejected' — admin rejected; credits refunded back to user's balance.
     */
    status: text('status').default('pending').notNull(),
    /** Free text: "Сбер 1234", "СБП", "ЮMoney", etc. */
    paymentMethod: text('payment_method'),
    /** Bank card masked, phone for СБП, etc. */
    paymentDetails: text('payment_details'),
    /** Internal admin-only notes. */
    adminNotes: text('admin_notes'),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
    processedAt: timestamptz('processed_at'),
    /** Email of the admin who flipped to paid/rejected. */
    processedBy: text('processed_by'),
  },
  (table) => [
    check('cashout_requests_credits_min_check', sql`${table.creditsRequested} >= 5000`),
    check(
      'cashout_requests_status_check',
      sql`${table.status} IN ('pending', 'approved', 'paid', 'rejected')`,
    ),
    index('cashout_requests_status_idx').on(table.status),
    index('cashout_requests_user_idx').on(table.userId),
  ],
);

export type CashoutRequestItem = typeof cashoutRequests.$inferSelect;
export type NewCashoutRequest = typeof cashoutRequests.$inferInsert;
