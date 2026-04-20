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
