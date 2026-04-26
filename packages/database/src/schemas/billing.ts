import {
  bigint,
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
    upgradeHintSentAt: timestamptz('upgrade_hint_sent_at'),
    lowCreditsHintSentAt: timestamptz('low_credits_hint_sent_at'),
    ...timestamps,
  },
  (table) => [index('user_billing_user_id_idx').on(table.userId)],
);

export type UserBillingItem = typeof userBilling.$inferSelect;
export type NewUserBilling = typeof userBilling.$inferInsert;
