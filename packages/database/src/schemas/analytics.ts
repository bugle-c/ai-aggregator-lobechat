import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamptz } from './_helpers';
import { billingPayments, billingPlans } from './billing';
import { users } from './user';

// ============ Usage Logs (raw per-request cost log) ============ //

export const usageLogs = pgTable(
  'usage_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    provider: text('provider').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    // Prompt-caching breakdown (Anthropic splits write TTL into 5m/1h; OpenAI
    // and Gemini only expose cached reads). All default to 0 for backwards
    // compatibility.
    cacheWrite5mTokens: integer('cache_write_5m_tokens').notNull().default(0),
    cacheWrite1hTokens: integer('cache_write_1h_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    creditsCharged: integer('credits_charged').notNull(),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull(),
    costRub: numeric('cost_rub', { precision: 10, scale: 4 }).notNull(),
    exchangeRate: numeric('exchange_rate', { precision: 8, scale: 4 }).notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('usage_logs_user_created_idx').on(table.userId, table.createdAt.desc()),
    index('usage_logs_created_idx').on(table.createdAt),
    index('usage_logs_model_idx').on(table.model),
    index('usage_logs_kind_idx').on(table.kind),
  ],
);

export type UsageLogItem = typeof usageLogs.$inferSelect;
export type NewUsageLog = typeof usageLogs.$inferInsert;

// ============ Usage Daily Rollup (per user × day × model) ============ //

export const usageDailyRollup = pgTable(
  'usage_daily_rollup',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    model: text('model').notNull(),
    requests: integer('requests').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    creditsCharged: integer('credits_charged').notNull().default(0),
    costRub: numeric('cost_rub', { precision: 14, scale: 4 }).notNull().default('0'),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.day, table.model] }),
    index('usage_daily_rollup_day_idx').on(table.day),
  ],
);

export type UsageDailyRollupItem = typeof usageDailyRollup.$inferSelect;
export type NewUsageDailyRollup = typeof usageDailyRollup.$inferInsert;

// ============ User Attribution (first + last touch UTM) ============ //

export const userAttribution = pgTable(
  'user_attribution',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    firstUtmSource: text('first_utm_source'),
    firstUtmMedium: text('first_utm_medium'),
    firstUtmCampaign: text('first_utm_campaign'),
    firstUtmContent: text('first_utm_content'),
    firstReferrer: text('first_referrer'),
    firstLandingPage: text('first_landing_page'),
    firstSeenAt: timestamptz('first_seen_at'),
    lastUtmSource: text('last_utm_source'),
    lastUtmMedium: text('last_utm_medium'),
    lastUtmCampaign: text('last_utm_campaign'),
    lastUtmContent: text('last_utm_content'),
    lastReferrer: text('last_referrer'),
    lastLandingPage: text('last_landing_page'),
    registeredAt: timestamptz('registered_at').notNull().defaultNow(),
  },
  (table) => [
    index('user_attribution_first_source_idx').on(table.firstUtmSource),
    index('user_attribution_last_source_idx').on(table.lastUtmSource),
  ],
);

export type UserAttributionItem = typeof userAttribution.$inferSelect;
export type NewUserAttribution = typeof userAttribution.$inferInsert;

// ============ Billing Subscription Events (MRR movements) ============ //

export const billingSubscriptionEvents = pgTable(
  'billing_subscription_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 32 }).notNull(),
    fromPlanId: integer('from_plan_id').references(() => billingPlans.id),
    toPlanId: integer('to_plan_id').references(() => billingPlans.id),
    mrrDeltaRub: integer('mrr_delta_rub').notNull().default(0),
    paymentId: uuid('payment_id').references(() => billingPayments.id),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('bse_user_idx').on(table.userId),
    index('bse_created_idx').on(table.createdAt),
    index('bse_type_idx').on(table.eventType),
  ],
);

export type BillingSubscriptionEventItem = typeof billingSubscriptionEvents.$inferSelect;
export type NewBillingSubscriptionEvent = typeof billingSubscriptionEvents.$inferInsert;

// ============ Upsell tracking (mobile-redesign Phase 1) ============ //
//
// Two thin event tables that capture the impression → click → paid
// funnel per upsell source (`plan_limit_chat`, `locked_model`,
// `balance_nudge`, `home_pill`, `welcome_email`). The
// /finance/pricing-experiments admin page joins these against
// billing_payments to compute conversion per source.

export const upsellImpressions = pgTable(
  'upsell_impressions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 32 }).notNull(),
    modelBlocked: text('model_blocked'),
    planOffered: text('plan_offered'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('upsell_imp_user_idx').on(table.userId),
    index('upsell_imp_source_idx').on(table.source),
    index('upsell_imp_created_idx').on(table.createdAt),
  ],
);

export type UpsellImpressionItem = typeof upsellImpressions.$inferSelect;
export type NewUpsellImpression = typeof upsellImpressions.$inferInsert;

export const upsellClicks = pgTable(
  'upsell_clicks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 32 }).notNull(),
    targetPlan: text('target_plan'),
    clickedAt: timestamptz('clicked_at').notNull().defaultNow(),
  },
  (table) => [
    index('upsell_click_user_idx').on(table.userId),
    index('upsell_click_source_idx').on(table.source),
    index('upsell_click_created_idx').on(table.clickedAt),
  ],
);

export type UpsellClickItem = typeof upsellClicks.$inferSelect;
export type NewUpsellClick = typeof upsellClicks.$inferInsert;
