/**
 * GET /api/cron/expiry-reminders
 *
 * Subscription-expiry reminders (Fix 3, post-payment plan 2026-09-13):
 *   - T-3 days: email «подписка истекает через 3 дня»
 *   - T0 (plan already dropped to free): email «тариф закончился» + Telegram DM
 *
 * Idempotent through user_billing.expiry_reminder_sent_at — see
 * `src/server/modules/lifecycle/expiringSubscriptions.ts`. Returns as soon
 * as nothing is due. Schedule from the host crontab every 6 hours.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` (same as the other cron routes).
 */
import { getServerDB } from '@/database/server';
import { runExpiryReminders } from '@/server/modules/lifecycle/runExpiryReminders';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const db = await getServerDB();
  const summary = await runExpiryReminders(db);
  return Response.json({ ok: true, ...summary });
}
