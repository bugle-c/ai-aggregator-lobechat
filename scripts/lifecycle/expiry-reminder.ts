/**
 * Phase 2.3 — Daily cron: send "subscription expires in 3 days" reminder.
 *
 * Run via systemd timer (see expiry-reminder.timer / .service in this dir),
 * scheduled for 10:00 MSK = 07:00 UTC. Idempotent: marks
 * user_billing.expiry_reminder_sent_at = now() after each send so reruns
 * within the same cycle are no-ops.
 *
 * Required env:
 *   DATABASE_URL    — postgres connection string for the lobechat DB.
 *   BREVO_API_KEY   — Brevo transactional API key. If missing, script logs
 *                     and exits 0 (no-op) so a misconfigured server doesn't
 *                     crash the cron loop.
 *   APP_URL         — defaults to https://ask.gptweb.ru (used in template).
 *
 * Optional flags via argv:
 *   --dry-run       — query and log target users, do not send or mark.
 *   --limit=N       — cap number of users processed in a single run.
 *
 * Usage (manual / cron):
 *   APP_URL=https://ask.gptweb.ru \
 *   DATABASE_URL=... BREVO_API_KEY=... \
 *   npx tsx scripts/lifecycle/expiry-reminder.ts
 */
import { Client } from 'pg';

import { sendLifecycleEmail } from '@/server/modules/lifecycle/email';
import { buildExpiryReminderEmail } from '@/server/modules/lifecycle/templates';

interface ExpiringRow {
  email: string | null;
  plan_id: number;
  plan_name: string;
  price_rub: number;
  subscription_expires_at: Date;
  user_id: string;
}

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run');
  let limit: number | null = null;
  for (const a of argv) {
    const m = a.match(/^--limit=(\d+)$/);
    if (m) limit = Number(m[1]);
  }
  return { dryRun, limit };
}

async function main() {
  const { dryRun, limit } = parseArgs(process.argv.slice(2));
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('[expiry-reminder] DATABASE_URL is required');
    process.exit(2);
  }
  if (!process.env.BREVO_API_KEY && !dryRun) {
    console.warn(
      '[expiry-reminder] BREVO_API_KEY not set — exiting 0 (no-op). Set it on the host.',
    );
    process.exit(0);
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const limitClause = limit ? `LIMIT ${Number(limit)}` : '';
    const queryText = `
      SELECT
        ub.user_id,
        u.email,
        ub.plan_id,
        bp.name AS plan_name,
        bp.price_rub,
        ub.subscription_expires_at
      FROM user_billing ub
      JOIN users u ON u.id = ub.user_id
      JOIN billing_plans bp ON bp.id = ub.plan_id
      WHERE ub.subscription_expires_at > now() + interval '2 days'
        AND ub.subscription_expires_at <= now() + interval '3 days'
        AND bp.price_rub > 0
        AND ub.expiry_reminder_sent_at IS NULL
      ORDER BY ub.subscription_expires_at ASC
      ${limitClause}
    `;
    const queryResult = await client.query<ExpiringRow>(queryText);
    const rows = queryResult.rows;

    console.info(`[expiry-reminder] target=${rows.length} dryRun=${dryRun}`);

    for (const row of rows) {
      if (!row.email) {
        console.warn(`[expiry-reminder] skip: user ${row.user_id} has no email`);
        skipped++;
        continue;
      }

      if (dryRun) {
        console.info(
          `[expiry-reminder] DRY: would send to ${row.email} (plan=${row.plan_name}, exp=${row.subscription_expires_at.toISOString()})`,
        );
        continue;
      }

      const tpl = buildExpiryReminderEmail({
        planName: row.plan_name,
        expiresAt: row.subscription_expires_at,
      });

      const sendResult = await sendLifecycleEmail({
        to: row.email,
        subject: tpl.subject,
        html: tpl.html,
        textBody: tpl.textBody,
      });

      if (sendResult.ok) {
        await client.query(
          'UPDATE user_billing SET expiry_reminder_sent_at = now() WHERE user_id = $1',
          [row.user_id],
        );
        console.info(`[expiry-reminder] sent: ${row.email} (${row.user_id})`);
        sent++;
      } else {
        console.error(
          `[expiry-reminder] failed: ${row.email} (${row.user_id}) — ${sendResult.error}`,
        );
        failed++;
      }
    }

    console.info(
      `[expiry-reminder] done — sent=${sent} failed=${failed} skipped=${skipped} dryRun=${dryRun}`,
    );
  } catch (err) {
    console.error('[expiry-reminder] fatal:', err);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error('[expiry-reminder] uncaught:', err);
  process.exit(1);
});
