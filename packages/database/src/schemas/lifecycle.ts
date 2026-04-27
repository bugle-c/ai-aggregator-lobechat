import { index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { timestamptz } from './_helpers';
import { billingPlans } from './billing';
import { users } from './user';

/**
 * Phase 2.3 — Subscription cancellation surveys.
 *
 * Captures the reason a paid subscriber gave when cancelling, used by the
 * /admin/finance/cancellation-surveys page to inform retention strategy.
 *
 * `reason_code` is constrained at the DB layer to a small enum
 * (`too_expensive`, `not_using_enough`, `switched_to_other`, `other`);
 * `reason_text` carries a free-form note when reason is `other` or as
 * additional context.
 *
 * `plan_id_before` is the plan the user was on at the moment of cancellation,
 * snapshotted because plan rows can be edited in admin.
 */
export const cancellationSurveys = pgTable(
  'cancellation_surveys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reasonCode: text('reason_code').notNull(),
    reasonText: text('reason_text'),
    planIdBefore: integer('plan_id_before').references(() => billingPlans.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('cancellation_surveys_user_idx').on(table.userId),
    index('cancellation_surveys_reason_idx').on(table.reasonCode),
    index('cancellation_surveys_created_idx').on(table.createdAt.desc()),
  ],
);

export type CancellationSurveyItem = typeof cancellationSurveys.$inferSelect;
export type NewCancellationSurvey = typeof cancellationSurveys.$inferInsert;

export const CANCELLATION_REASON_CODES = [
  'too_expensive',
  'not_using_enough',
  'switched_to_other',
  'other',
] as const;

export type CancellationReasonCode = (typeof CANCELLATION_REASON_CODES)[number];
