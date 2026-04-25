import { boolean, pgTable, text } from 'drizzle-orm/pg-core';

import { timestamptz } from './_helpers';
import { users } from './user';

/**
 * Tracks per-user onboarding flags so we can show the welcome modal,
 * the first-message toast, and similar one-time UX nudges exactly once.
 */
export const userOnboarding = pgTable('user_onboarding', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  firstLoginSeen: boolean('first_login_seen').notNull().default(false),
  firstMessageSeen: boolean('first_message_seen').notNull().default(false),
  firstToastSeen: boolean('first_toast_seen').notNull().default(false),
  bannerDismissedAt: timestamptz('banner_dismissed_at'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type UserOnboardingItem = typeof userOnboarding.$inferSelect;
export type NewUserOnboarding = typeof userOnboarding.$inferInsert;
