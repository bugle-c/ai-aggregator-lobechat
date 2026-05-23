import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';

// ============ Billing Plans ============ //

export const billingPlans = pgTable('billing_plans', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: varchar('slug', { length: 32 }).notNull().unique(),
  priceRub: integer('price_rub').notNull().default(0),
  tokenLimit: integer('token_limit').notNull().default(50000),
  dailyCreditLimit: integer('daily_credit_limit'),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

export type BillingPlanItem = typeof billingPlans.$inferSelect;
export type NewBillingPlan = typeof billingPlans.$inferInsert;

// ============ Billing Payments ============ //

export const billingPayments = pgTable(
  'billing_payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 16 }).notNull(),
    amountRub: integer('amount_rub').notNull(),
    yookassaPaymentId: text('yookassa_payment_id').unique(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    planId: integer('plan_id').references(() => billingPlans.id),
    tokensAmount: integer('tokens_amount'),
    metadata: jsonb('metadata').default({}),
    botNotifyPending: boolean('bot_notify_pending').notNull().default(false),
    botNotifiedAt: timestamptz('bot_notified_at'),
    ...timestamps,
  },
  (table) => [
    index('billing_payments_user_id_idx').on(table.userId),
    index('billing_payments_yookassa_id_idx').on(table.yookassaPaymentId),
    index('billing_payments_status_idx').on(table.status),
  ],
);

export type BillingPaymentItem = typeof billingPayments.$inferSelect;
export type NewBillingPayment = typeof billingPayments.$inferInsert;

// ============ User Billing State ============ //

export const userBilling = pgTable(
  'user_billing',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: integer('plan_id')
      .notNull()
      .default(1)
      .references(() => billingPlans.id),
    tokenBalance: integer('token_balance').notNull().default(0),
    tokensUsedMonth: integer('tokens_used_month').notNull().default(0),
    monthStart: timestamptz('month_start').notNull().defaultNow(),
    subscriptionExpiresAt: timestamptz('subscription_expires_at'),
    // Bot integration: chat_id for DM delivery (bigint — TG group IDs can exceed int32)
    tgBotChatId: bigint('tg_bot_chat_id', { mode: 'number' }),
    botNotifyPending: boolean('bot_notify_pending').notNull().default(false),
    botNotifyType: text('bot_notify_type'),
    zeroCreditsNotifiedAt: timestamptz('zero_credits_notified_at'),
    expiryWarningSentAt: timestamptz('expiry_warning_sent_at'),
    expiryReminderSentAt: timestamptz('expiry_reminder_sent_at'),
    upgradeHintSentAt: timestamptz('upgrade_hint_sent_at'),
    lowCreditsHintSentAt: timestamptz('low_credits_hint_sent_at'),
    // Auto-renew loop. When `autoRenew=true` and `subscriptionExpiresAt`
    // approaches, the renew-due-subscriptions cron charges the saved
    // YooKassa payment method and pushes the expiry forward one billing
    // cycle. Cancellation flips this to false; the subscription stays
    // active until expiry, then passively returns to free.
    autoRenew: boolean('auto_renew').notNull().default(true),
    paymentMethodId: text('payment_method_id'),
    cancelledAt: timestamptz('cancelled_at'),
    cancelReasonCode: text('cancel_reason_code'),
    /** Separate balance for non-renewable bonus credits. Adds to
     *  totalAvailable while bonusBalanceExpiresAt > NOW(). Zeroed by
     *  the daily expire-bonus-balance cron once past expiry. */
    bonusBalance: integer('bonus_balance').notNull().default(0),

    /** When the current bonusBalance becomes worthless. NULL means no
     *  active bonus. Set by grant code; read by checkUsageLimit and the
     *  daily expiry cron. */
    bonusBalanceExpiresAt: timestamptz('bonus_balance_expires_at'),

    /** Permanent anti-fraud stamp. Set on first TG-link bonus grant;
     *  never cleared. Re-link attempts read this and skip the grant. */
    tgBonusClaimedAt: timestamptz('tg_bonus_claimed_at'),
    ...timestamps,
  },
  (table) => [index('user_billing_user_id_idx').on(table.userId)],
);

export type UserBillingItem = typeof userBilling.$inferSelect;
export type NewUserBilling = typeof userBilling.$inferInsert;

// ============ Promo Codes ============ //

export const promoCodes = pgTable('promo_codes', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  type: text('type').notNull(), // 'plan_upgrade' | 'token_bonus' (CHECK constraint at DB)
  planId: integer('plan_id').references(() => billingPlans.id),
  tokenAmount: integer('token_amount'),
  durationDays: integer('duration_days'),
  maxUses: integer('max_uses').notNull().default(1),
  usedCount: integer('used_count').notNull().default(0),
  expiresAt: timestamptz('expires_at'),
  isActive: boolean('is_active').notNull().default(true),
  /**
   * If true, this promo is the one rendered on the public blog CTA. A
   * partial unique index in the DB enforces at most one row with this
   * flag (`promo_codes_use_in_blog_unique_idx WHERE use_in_blog`), so
   * the landing never has to pick between competing rows.
   */
  useInBlog: boolean('use_in_blog').notNull().default(false),
  createdBy: text('created_by'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export type PromoCodeItem = typeof promoCodes.$inferSelect;
export type NewPromoCode = typeof promoCodes.$inferInsert;

export const promoRedemptions = pgTable(
  'promo_redemptions',
  {
    id: serial('id').primaryKey(),
    promoId: integer('promo_id')
      .notNull()
      .references(() => promoCodes.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    redeemedAt: timestamptz('redeemed_at').notNull().defaultNow(),
  },
  (table) => [
    // UNIQUE (promo_id, user_id) — enforced at DB; mirrors the migration
    index('promo_redemptions_promo_user_idx').on(table.promoId, table.userId),
  ],
);

export type PromoRedemptionItem = typeof promoRedemptions.$inferSelect;
export type NewPromoRedemption = typeof promoRedemptions.$inferInsert;

// ============ Message Feedback ============ //

export const messageFeedback = pgTable(
  'message_feedback',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull(),
    rating: text('rating').notNull(), // 'up' | 'down' (CHECK constraint enforced at DB)
    source: text('source').notNull().default('web'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [index('message_feedback_user_msg_idx').on(table.userId, table.messageId)],
);

export type MessageFeedbackItem = typeof messageFeedback.$inferSelect;
export type NewMessageFeedback = typeof messageFeedback.$inferInsert;
