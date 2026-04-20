import { index, integer, numeric, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';

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
