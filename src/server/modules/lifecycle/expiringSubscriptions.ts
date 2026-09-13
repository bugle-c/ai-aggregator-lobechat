/**
 * Phase 2.3 — Selection logic for subscription-expiry reminders.
 *
 * Two legs, both driven by the `/api/cron/expiry-reminders` route:
 *
 *   T-3  `listExpiringSubscriptions` — user_billing rows on a paid plan
 *        (priceRub > 0) whose subscription_expires_at falls in
 *        (now + 2 days, now + 3 days] and expiry_reminder_sent_at IS NULL.
 *
 *   T0   `listExpiredSubscriptions` — users already dropped to the free
 *        plan (plan_id = 1) by `expireSubscriptions` whose latest
 *        `cancelled` event in billing_subscription_events is younger than
 *        EXPIRED_EMAIL_WINDOW_DAYS and has not been announced yet.
 *
 * Idempotency for BOTH legs is the single `expiry_reminder_sent_at`
 * column: the T-3 leg requires it to be NULL, the T0 leg requires it to
 * be NULL or OLDER than the expiry event (the T-3 stamp always predates
 * the expiry, the T0 stamp always postdates it). `updatePlan` clears the
 * column on every plan change, so the next paid cycle starts clean. No
 * extra column, no migration.
 *
 * The in-app banner (`resolveExpiredPlanNotice`) shares the "latest event
 * is an expiry, user is on free" rule with a longer window.
 */
import { and, desc, eq, gt, isNull, lt, lte, or, sql } from 'drizzle-orm';

import { billingPlans, billingSubscriptionEvents, userBilling, users } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';

/** How long after the expiry the "your plan ended" email is still worth sending. */
export const EXPIRED_EMAIL_WINDOW_DAYS = 3;
/** How long after the expiry the in-app "renew" banner stays eligible. */
export const EXPIRED_BANNER_WINDOW_DAYS = 14;

const FREE_PLAN_ID = 1;

export interface ExpiringSubscriptionRow {
  email: string | null;
  planId: number;
  planName: string;
  planPriceRub: number;
  subscriptionExpiresAt: Date;
  userId: string;
}

export interface ExpiredSubscriptionRow {
  email: string | null;
  /** When the plan actually ended (createdAt of the `cancelled` event). */
  expiredAt: Date;
  planId: number | null;
  planName: string;
  tgBotChatId: number | null;
  userId: string;
}

/** Fetch users with subscriptions expiring in (now+2d, now+3d] who have no reminder yet. */
export async function listExpiringSubscriptions(
  db: LobeChatDatabase,
): Promise<ExpiringSubscriptionRow[]> {
  // Drizzle interval arithmetic: cast `now() + interval '...'` via SQL fragment.
  const lowerBound = sql`now() + interval '2 days'`;
  const upperBound = sql`now() + interval '3 days'`;

  const rows = await db
    .select({
      userId: userBilling.userId,
      email: users.email,
      planId: userBilling.planId,
      planName: billingPlans.name,
      planPriceRub: billingPlans.priceRub,
      subscriptionExpiresAt: userBilling.subscriptionExpiresAt,
    })
    .from(userBilling)
    .innerJoin(users, eq(users.id, userBilling.userId))
    .innerJoin(billingPlans, eq(billingPlans.id, userBilling.planId))
    .where(
      and(
        // paid plan: id != 1 AND priceRub > 0 (defence in depth)
        gt(billingPlans.priceRub, 0),
        // expiry between now+2d and now+3d (inclusive upper)
        gt(userBilling.subscriptionExpiresAt, lowerBound),
        lte(userBilling.subscriptionExpiresAt, upperBound),
        // not already reminded this cycle
        isNull(userBilling.expiryReminderSentAt),
      ),
    );

  return rows
    .filter(
      (r): r is typeof r & { subscriptionExpiresAt: Date } => r.subscriptionExpiresAt !== null,
    )
    .map((r) => ({
      userId: r.userId,
      email: r.email,
      planId: r.planId,
      planName: r.planName,
      planPriceRub: r.planPriceRub,
      subscriptionExpiresAt: r.subscriptionExpiresAt as Date,
    }));
}

/**
 * Fetch users whose paid plan ended within EXPIRED_EMAIL_WINDOW_DAYS and who
 * have not received the "plan ended" notice for that expiry yet. One row per
 * user (latest expiry event wins).
 */
export async function listExpiredSubscriptions(
  db: LobeChatDatabase,
): Promise<ExpiredSubscriptionRow[]> {
  const rows = await db
    .select({
      userId: billingSubscriptionEvents.userId,
      email: users.email,
      tgBotChatId: userBilling.tgBotChatId,
      planId: billingSubscriptionEvents.fromPlanId,
      planName: billingPlans.name,
      expiredAt: billingSubscriptionEvents.createdAt,
    })
    .from(billingSubscriptionEvents)
    .innerJoin(userBilling, eq(userBilling.userId, billingSubscriptionEvents.userId))
    .innerJoin(users, eq(users.id, billingSubscriptionEvents.userId))
    .leftJoin(billingPlans, eq(billingPlans.id, billingSubscriptionEvents.fromPlanId))
    .where(
      and(
        eq(billingSubscriptionEvents.eventType, 'cancelled'),
        gt(
          billingSubscriptionEvents.createdAt,
          sql.raw(`now() - interval '${EXPIRED_EMAIL_WINDOW_DAYS} days'`),
        ),
        // Already dropped to free by expireSubscriptions — a user-initiated
        // cancel (auto-renew off) also writes `cancelled` while the plan is
        // still active; that one must wait for the real expiry.
        eq(userBilling.planId, FREE_PLAN_ID),
        or(
          isNull(userBilling.expiryReminderSentAt),
          lt(userBilling.expiryReminderSentAt, billingSubscriptionEvents.createdAt),
        ),
      ),
    )
    .orderBy(desc(billingSubscriptionEvents.createdAt));

  const seen = new Set<string>();
  const result: ExpiredSubscriptionRow[] = [];
  for (const r of rows) {
    if (seen.has(r.userId)) continue;
    seen.add(r.userId);
    result.push({
      userId: r.userId,
      email: r.email,
      tgBotChatId: r.tgBotChatId,
      planId: r.planId,
      planName: r.planName ?? 'WebGPT',
      expiredAt: r.expiredAt,
    });
  }
  return result;
}

/**
 * Stamp `expiry_reminder_sent_at = now()`. Used by both legs: after the T-3
 * reminder it blocks a second T-3 send; after the T0 notice it postdates the
 * expiry event and blocks a second T0 send.
 */
export async function markReminderSent(db: LobeChatDatabase, userId: string): Promise<void> {
  await db
    .update(userBilling)
    .set({ expiryReminderSentAt: new Date() })
    .where(eq(userBilling.userId, userId));
}

/**
 * Addresses we mint ourselves for social sign-ins (Telegram login/bot,
 * WeChat). Nothing is listening behind them — never send there.
 */
const SYNTHETIC_EMAIL_PATTERNS = [/@bot\.gptweb\.ru$/i, /@telegram/i, /@wechat\.lobehub$/i];

export function isSyntheticEmail(email: string | null | undefined): boolean {
  if (!email) return true;
  return SYNTHETIC_EMAIL_PATTERNS.some((re) => re.test(email));
}

/**
 * Pure predicate version of the SQL filter — used in tests and as a final
 * defence-in-depth check before sending the email (in case query semantics
 * drift).
 *
 * Returns true iff `expiresAt` falls in the half-open window
 * `(now+2d, now+3d]` and `priceRub > 0` and `reminderSentAt` is null.
 */
export function isExpiringWithinWindow(args: {
  expiresAt: Date | null;
  reminderSentAt: Date | null;
  priceRub: number;
  now?: Date;
}): boolean {
  if (!args.expiresAt) return false;
  if (args.reminderSentAt) return false;
  if (args.priceRub <= 0) return false;
  const now = (args.now ?? new Date()).getTime();
  const t = args.expiresAt.getTime();
  const twoDays = 2 * 24 * 60 * 60 * 1000;
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  return t > now + twoDays && t <= now + threeDays;
}

/**
 * Pure predicate mirroring `listExpiredSubscriptions`: the user is on the
 * free plan, the latest subscription event is an expiry younger than
 * `windowDays`, and no notice was stamped after that event.
 */
export function isExpiredNoticeDue(args: {
  eventCreatedAt: Date | null;
  eventType: string | null;
  now?: Date;
  planId: number;
  reminderSentAt: Date | null;
  windowDays?: number;
}): boolean {
  if (args.planId !== FREE_PLAN_ID) return false;
  if (args.eventType !== 'cancelled' || !args.eventCreatedAt) return false;
  const now = (args.now ?? new Date()).getTime();
  const windowMs = (args.windowDays ?? EXPIRED_EMAIL_WINDOW_DAYS) * 24 * 60 * 60 * 1000;
  const t = args.eventCreatedAt.getTime();
  if (t <= now - windowMs || t > now) return false;
  return !args.reminderSentAt || args.reminderSentAt.getTime() < t;
}

export interface ExpiredPlanNotice {
  /** Stable id for client-side dismissal (one dismissal per expiry). */
  eventId: string;
  expiredAt: Date;
  planName: string;
}

/**
 * In-app banner rule: latest subscription event is an expiry within
 * EXPIRED_BANNER_WINDOW_DAYS and the user is on the free plan. Pure — the
 * router fetches the row, this decides.
 */
export function resolveExpiredPlanNotice(args: {
  latestEvent: {
    createdAt: Date;
    eventType: string;
    id: string;
    planName: string | null;
  } | null;
  now?: Date;
  planId: number;
}): ExpiredPlanNotice | null {
  const { latestEvent, planId } = args;
  if (!latestEvent) return null;
  const due = isExpiredNoticeDue({
    eventCreatedAt: latestEvent.createdAt,
    eventType: latestEvent.eventType,
    now: args.now,
    planId,
    // Never stamped for the banner — dismissal lives on the client.
    reminderSentAt: null,
    windowDays: EXPIRED_BANNER_WINDOW_DAYS,
  });
  if (!due) return null;
  return {
    eventId: latestEvent.id,
    expiredAt: latestEvent.createdAt,
    planName: latestEvent.planName ?? 'WebGPT',
  };
}
