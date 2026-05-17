import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

export const broadcastCampaigns = pgTable('broadcast_campaigns', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull().default('draft'),
  channels: text('channels').array().notNull().default(['email']),
  audience: text('audience').notNull().default('all'),

  emailSubject: text('email_subject'),
  emailBodyHtml: text('email_body_html'),
  emailFromName: text('email_from_name').default('WebGPT'),
  emailFromAddr: text('email_from_addr').default('noreply@gptweb.ru'),

  botMessageMd: text('bot_message_md'),
  botImageUrls: text('bot_image_urls').array().default([]),

  promoCode: text('promo_code'),
  promoBonusCredits: integer('promo_bonus_credits').default(0),
  promoWindowHours: integer('promo_window_hours').default(24),

  dailyCap: integer('daily_cap').notNull().default(150),

  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  doneAt: timestamp('done_at', { withTimezone: true }),
});

export const broadcastRecipients = pgTable(
  'broadcast_recipients',
  {
    id: serial('id').primaryKey(),
    campaignId: integer('campaign_id')
      .notNull()
      .references(() => broadcastCampaigns.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    email: text('email'),
    tgChatId: integer('tg_chat_id'),
    channel: text('channel').notNull(),
    status: text('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),

    sentAt: timestamp('sent_at', { withTimezone: true }),
    brevoMessageId: text('brevo_message_id'),
    tgMessageId: integer('tg_message_id'),

    openedAt: timestamp('opened_at', { withTimezone: true }),
    clickedAt: timestamp('clicked_at', { withTimezone: true }),
    clickCount: integer('click_count').notNull().default(0),

    paidAt: timestamp('paid_at', { withTimezone: true }),
    paymentId: text('payment_id'),
    paymentAmountRub: integer('payment_amount_rub'),
    promoRedeemedAt: timestamp('promo_redeemed_at', { withTimezone: true }),
    bonusCreditsGranted: integer('bonus_credits_granted'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('broadcast_recipients_uniq').on(table.campaignId, table.userId, table.channel),
    index('bc_recipients_pending_idx').on(table.campaignId, table.status),
    index('bc_recipients_user_idx').on(table.userId),
  ],
);

export const broadcastEvents = pgTable('broadcast_events', {
  id: serial('id').primaryKey(),
  campaignId: integer('campaign_id').references(() => broadcastCampaigns.id, {
    onDelete: 'cascade',
  }),
  recipientId: integer('recipient_id').references(() => broadcastRecipients.id, {
    onDelete: 'cascade',
  }),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
