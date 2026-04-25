/**
 * Hourly billing sanity-check cron.
 *
 * Surfaces financial anomalies that "shouldn't happen" after the
 * pre-charge + atomic write changes shipped in earlier billing
 * packages. Each individual check is wrapped in its own try/catch so
 * one broken probe never silences the others.
 *
 * Checks:
 *   A) negative-balances     — users in red or way past their plan limit
 *   B) markup-sanity         — admin typo: markup outside 1.5x..10x
 *   C) reconciliation        — booked usage_logs.cost_usd vs API rate
 *                              sanity (drift detection — coarse)
 *   D) stuck-async-tasks     — video tasks pending/processing > 1h
 *
 * Triggered from a host-level cron: see tasks/cron/billing-sanity-host.cron.
 */
import { AsyncTaskStatus } from '@lobechat/types';
import { and, count, eq, inArray, lt, or, sql } from 'drizzle-orm';

import { asyncTasks, billingPlans, usageLogs, userBilling } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { sendAlert } from '@/server/services/alerts';
import { fetchAllRates } from '@/server/services/billing/rates-source';

type CheckSeverity = 'ok' | 'warning' | 'critical' | 'error';

interface CheckResult {
  details?: unknown;
  error?: string;
  name: string;
  severity: CheckSeverity;
}

const STUCK_TASK_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const STUCK_TASK_ALERT_THRESHOLD = 5;

// Markup outside this range is almost certainly an admin typo
// (e.g. forgot the decimal point — `30` instead of `3.0`).
const MARKUP_MIN = 1.5;
const MARKUP_MAX = 10;

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const db = await getServerDB();
  const checks: CheckResult[] = [];

  // --- A) negative-balances -------------------------------------------------
  // Conditions that should never be true post-precharge:
  //   * tokens_used_month < 0
  //   * tokens_used_month > plan.token_limit + token_balance + 100
  //     (small tolerance for rounding / inflight charges)
  try {
    const overshootRows = await db
      .select({
        planId: userBilling.planId,
        planTokenLimit: billingPlans.tokenLimit,
        tokenBalance: userBilling.tokenBalance,
        tokensUsedMonth: userBilling.tokensUsedMonth,
        userId: userBilling.userId,
      })
      .from(userBilling)
      .innerJoin(billingPlans, eq(billingPlans.id, userBilling.planId))
      .where(
        or(
          lt(userBilling.tokensUsedMonth, 0),
          sql`${userBilling.tokensUsedMonth} > ${billingPlans.tokenLimit} + ${userBilling.tokenBalance} + 100`,
        ),
      )
      .limit(50);

    if (overshootRows.length > 0) {
      const body = overshootRows
        .map(
          (r) =>
            `- ${r.userId}: used=${r.tokensUsedMonth} balance=${r.tokenBalance} planLimit=${r.planTokenLimit} (planId=${r.planId})`,
        )
        .join('\n');
      checks.push({
        details: overshootRows,
        name: 'negative-balances',
        severity: 'critical',
      });
      await sendAlert({
        body,
        severity: 'critical',
        title: `${overshootRows.length} users with negative or overshoot balance`,
      });
    } else {
      checks.push({ name: 'negative-balances', severity: 'ok' });
    }
  } catch (err) {
    checks.push({
      error: err instanceof Error ? err.message : String(err),
      name: 'negative-balances',
      severity: 'error',
    });
  }

  // --- B) markup-sanity -----------------------------------------------------
  // Read via the existing rates-source cache so we don't open a second
  // Supabase connection. fetchAllRates() returns active rates only.
  try {
    const rates = await fetchAllRates();
    const offenders = rates.filter(
      (r) => !Number.isFinite(r.markup) || r.markup < MARKUP_MIN || r.markup > MARKUP_MAX,
    );
    if (offenders.length > 0) {
      const body = offenders
        .map((r) => `- ${r.modelId} (${r.provider}): markup=${r.markup}`)
        .join('\n');
      checks.push({
        details: offenders.map((r) => ({
          markup: r.markup,
          modelId: r.modelId,
          provider: r.provider,
        })),
        name: 'markup-sanity',
        severity: 'warning',
      });
      await sendAlert({
        body,
        severity: 'warning',
        title: `${offenders.length} model rates with suspicious markup (<${MARKUP_MIN}x or >${MARKUP_MAX}x)`,
      });
    } else {
      checks.push({ name: 'markup-sanity', severity: 'ok' });
    }
  } catch (err) {
    checks.push({
      error: err instanceof Error ? err.message : String(err),
      name: 'markup-sanity',
      severity: 'error',
    });
  }

  // --- C) reconciliation (coarse) -------------------------------------------
  // We don't have manual_expenses in this DB yet; perform a lighter sanity
  // probe — flag if any usage_logs row this month has cost_usd <= 0 with
  // creditsCharged > 0 (meaning we charged the user but recorded zero
  // upstream cost — likely a rate-source miss / bug).
  try {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const zeroCostRows = await db
      .select({
        creditsCharged: usageLogs.creditsCharged,
        id: usageLogs.id,
        model: usageLogs.model,
        provider: usageLogs.provider,
        userId: usageLogs.userId,
      })
      .from(usageLogs)
      .where(
        and(
          sql`${usageLogs.createdAt} >= ${monthStart.toISOString()}`,
          sql`${usageLogs.costUsd}::numeric <= 0`,
          sql`${usageLogs.creditsCharged} > 0`,
        ),
      )
      .limit(20);

    if (zeroCostRows.length > 0) {
      const body = zeroCostRows
        .map(
          (r) =>
            `- log=${r.id} user=${r.userId} model=${r.model} provider=${r.provider} credits=${r.creditsCharged}`,
        )
        .join('\n');
      checks.push({
        details: zeroCostRows,
        name: 'reconciliation',
        severity: 'warning',
      });
      await sendAlert({
        body,
        severity: 'warning',
        title: `${zeroCostRows.length} usage_logs rows with credits charged but cost_usd <= 0`,
      });
    } else {
      checks.push({ name: 'reconciliation', severity: 'ok' });
    }
  } catch (err) {
    checks.push({
      error: err instanceof Error ? err.message : String(err),
      name: 'reconciliation',
      severity: 'error',
    });
  }

  // --- D) stuck-async-tasks -------------------------------------------------
  try {
    const cutoff = new Date(Date.now() - STUCK_TASK_THRESHOLD_MS);
    const [{ stuckCount }] = await db
      .select({ stuckCount: count() })
      .from(asyncTasks)
      .where(
        and(
          eq(asyncTasks.type, 'video_generation'),
          inArray(asyncTasks.status, [AsyncTaskStatus.Pending, AsyncTaskStatus.Processing]),
          lt(asyncTasks.createdAt, cutoff),
        ),
      );

    const stuck = Number(stuckCount ?? 0);

    if (stuck > STUCK_TASK_ALERT_THRESHOLD) {
      checks.push({
        details: { count: stuck, thresholdMs: STUCK_TASK_THRESHOLD_MS },
        name: 'stuck-async-tasks',
        severity: 'warning',
      });
      await sendAlert({
        body: `${stuck} video tasks are pending/processing for >1h. Cron polling may be broken or the upstream provider is degraded.`,
        severity: 'warning',
        title: `${stuck} stuck async video tasks (>1h)`,
      });
    } else {
      checks.push({
        details: { count: stuck },
        name: 'stuck-async-tasks',
        severity: 'ok',
      });
    }
  } catch (err) {
    checks.push({
      error: err instanceof Error ? err.message : String(err),
      name: 'stuck-async-tasks',
      severity: 'error',
    });
  }

  return Response.json({
    checks,
    scannedAt: new Date().toISOString(),
  });
}
