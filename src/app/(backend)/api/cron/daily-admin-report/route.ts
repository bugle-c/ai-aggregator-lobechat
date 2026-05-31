/**
 * Daily admin Telegram digest — 09:00 MSK.
 *
 * One self-contained POST endpoint that pulls business metrics for "yesterday
 * MSK" (24-h window) plus month-to-date roll-ups and sends a Markdown summary
 * to the operator's Telegram. No persistence — pure read + send.
 *
 * Sections of the message:
 *   1. Money:    revenue yesterday, MTD revenue + YoY comparison
 *   2. API:      WaveSpeed + OpenRouter spend yesterday, MTD margin
 *   3. Subs:     new / renewals / cancellations yesterday, active count, ARPU
 *   4. Top-3:    most expensive models by spend yesterday
 *   5. Balances: WaveSpeed credit, OpenRouter credit
 *   6. Alerts:   failed payments, stuck async jobs, single-user spend bombs
 *
 * Auth: Bearer CRON_SECRET header.
 *
 * Triggered from host cron — see tasks/cron/daily-admin-report-host.cron.
 */
import { and, desc, eq, gte, lt, sql as drizzleSql } from 'drizzle-orm';

import { usageLogs } from '@/database/schemas';
import { billingPayments, billingPlans, userBilling } from '@/database/schemas/billing';
import { getServerDB } from '@/database/server';
import { sendAlert } from '@/server/services/alerts';

const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const USD_TO_RUB = Number.parseFloat(process.env.USD_TO_RUB ?? '90');

interface WaveSpeedUsageResp {
  data?: {
    daily_usage?: Array<{ amount: number; count: number; date: string }>;
    per_model_usage?: Array<{
      model_uuid: string;
      total_cost: number;
      total_count: number;
    }>;
    summary?: { total_cost: number; total_requests: number };
  };
}

interface OpenRouterCreditsResp {
  data?: { total_credits?: number; total_usage?: number };
}

/**
 * Returns the MSK midnight as a Date for `daysAgo` days ago.
 * Yesterday = daysAgo=1.
 */
function mskMidnight(daysAgo: number): Date {
  // MSK = UTC+3. We want "00:00 MSK" which is "21:00 UTC of (day-1)".
  // Easiest: take now in UTC, subtract `daysAgo` days, then floor to MSK day.
  const now = new Date();
  const utc = new Date(now.getTime() - daysAgo * 86_400_000);
  // Shift to MSK then strip time, then shift back.
  const mskDate = new Date(utc.getTime() + 3 * 3_600_000);
  mskDate.setUTCHours(0, 0, 0, 0);
  return new Date(mskDate.getTime() - 3 * 3_600_000);
}

function fmtRub(n: number): string {
  return `${Math.round(n).toLocaleString('ru-RU')} ₽`;
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number, digits = 0): string {
  return `${n.toFixed(digits)}%`;
}

function escapeMd(s: string): string {
  // Minimal escape — Telegram Markdown v1 trips on `_*[`. Leaving `(){}` alone
  // because they appear in model ids and we'd rather have the raw id than a
  // mangled one.
  return s.replaceAll(/([_*[`])/g, '\\$1');
}

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const startedAt = Date.now();

  // Time windows (MSK day boundaries).
  const yStart = mskMidnight(1);
  const yEnd = mskMidnight(0); // today 00:00 MSK = end of yesterday
  const monthStart = (() => {
    const d = new Date(yEnd);
    d.setUTCDate(1);
    d.setUTCHours(-3, 0, 0, 0); // shift to MSK-1-st 00:00
    return d;
  })();
  const prevMonthStart = (() => {
    const d = new Date(monthStart);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d;
  })();
  // Same fraction of previous month for YoY-ish comparison.
  const prevMonthMtdEnd = (() => {
    const dayOfMonth = yEnd.getUTCDate(); // 1..31
    const d = new Date(prevMonthStart);
    d.setUTCDate(dayOfMonth);
    return d;
  })();
  const yDate = yStart.toISOString().slice(0, 10);

  const db = await getServerDB();

  // ===== 1. Money — revenue =====
  const [revYesterday, revMtd, revPrevMtd] = await Promise.all([
    db
      .select({
        rub: drizzleSql<number>`COALESCE(SUM(${billingPayments.amountRub}),0)::int`,
        cnt: drizzleSql<number>`COUNT(*)::int`,
      })
      .from(billingPayments)
      .where(
        and(
          eq(billingPayments.status, 'succeeded'),
          gte(billingPayments.createdAt, yStart),
          lt(billingPayments.createdAt, yEnd),
        ),
      ),
    db
      .select({
        rub: drizzleSql<number>`COALESCE(SUM(${billingPayments.amountRub}),0)::int`,
        cnt: drizzleSql<number>`COUNT(*)::int`,
      })
      .from(billingPayments)
      .where(
        and(
          eq(billingPayments.status, 'succeeded'),
          gte(billingPayments.createdAt, monthStart),
          lt(billingPayments.createdAt, yEnd),
        ),
      ),
    db
      .select({ rub: drizzleSql<number>`COALESCE(SUM(${billingPayments.amountRub}),0)::int` })
      .from(billingPayments)
      .where(
        and(
          eq(billingPayments.status, 'succeeded'),
          gte(billingPayments.createdAt, prevMonthStart),
          lt(billingPayments.createdAt, prevMonthMtdEnd),
        ),
      ),
  ]);

  const revY = Number(revYesterday[0]?.rub ?? 0);
  const revYCount = Number(revYesterday[0]?.cnt ?? 0);
  const revM = Number(revMtd[0]?.rub ?? 0);
  const revMCount = Number(revMtd[0]?.cnt ?? 0);
  const revPM = Number(revPrevMtd[0]?.rub ?? 0);
  const momRatio = revPM > 0 ? revM / revPM : null;

  // ===== 2. API costs — OpenRouter (sum usage_logs.cost_usd) =====
  // Bucketing mirrors sync-invoices: exclude WaveSpeed + local + HF.
  const isWavespeedSql = drizzleSql`(
       ${usageLogs.model} LIKE 'wavespeed-ai/%'
    OR ${usageLogs.model} LIKE 'google/veo%' OR ${usageLogs.model} LIKE 'google/nano-banana%' OR ${usageLogs.model} LIKE 'google/imagen%'
    OR ${usageLogs.model} LIKE 'openai/gpt-image%' OR ${usageLogs.model} LIKE 'openai/sora%' OR ${usageLogs.model} LIKE 'openai/dall-e%'
    OR ${usageLogs.model} LIKE 'bytedance/seedream%' OR ${usageLogs.model} LIKE 'bytedance/seedance%'
    OR ${usageLogs.model} LIKE 'kwaivgi/kling%' OR ${usageLogs.model} LIKE 'alibaba/wan%' OR ${usageLogs.model} LIKE 'alibaba/qwen-image%'
    OR ${usageLogs.model} LIKE 'fal-ai/%' OR ${usageLogs.model} LIKE 'pruna-ai/%' OR ${usageLogs.model} LIKE 'pika/%'
    OR ${usageLogs.model} LIKE 'higgsfield/%' OR ${usageLogs.model} LIKE 'skywork-ai/%' OR ${usageLogs.model} LIKE 'recraft-ai/%' OR ${usageLogs.model} LIKE 'midjourney/%'
    OR ${usageLogs.model} LIKE '%/text-to-image%' OR ${usageLogs.model} LIKE '%/text-to-video%' OR ${usageLogs.model} LIKE '%/image-to-video%' OR ${usageLogs.model} LIKE '%/image-to-image%'
  )`;
  const isLocalSql = drizzleSql`(
       ${usageLogs.model} LIKE 'gemma4:%'
    OR ${usageLogs.model} LIKE 'qwen3-coder:%'
    OR ${usageLogs.model} LIKE 'hf.co/TrevorJS/gemma-%'
  )`;
  const isHfSql = drizzleSql`(${usageLogs.model} LIKE 'hf.co/%' AND NOT ${isLocalSql})`;
  const isOpenRouterSql = drizzleSql`(NOT ${isWavespeedSql} AND NOT ${isHfSql} AND NOT ${isLocalSql})`;

  const [orYesterday, orMtd, topModelsY] = await Promise.all([
    db
      .select({ sum: drizzleSql<number>`COALESCE(SUM(${usageLogs.costUsd}::numeric),0)::float8` })
      .from(usageLogs)
      .where(and(gte(usageLogs.createdAt, yStart), lt(usageLogs.createdAt, yEnd), isOpenRouterSql)),
    db
      .select({ sum: drizzleSql<number>`COALESCE(SUM(${usageLogs.costUsd}::numeric),0)::float8` })
      .from(usageLogs)
      .where(
        and(gte(usageLogs.createdAt, monthStart), lt(usageLogs.createdAt, yEnd), isOpenRouterSql),
      ),
    db
      .select({
        model: usageLogs.model,
        cost: drizzleSql<number>`COALESCE(SUM(${usageLogs.costUsd}::numeric),0)::float8`,
        cnt: drizzleSql<number>`COUNT(*)::int`,
      })
      .from(usageLogs)
      .where(and(gte(usageLogs.createdAt, yStart), lt(usageLogs.createdAt, yEnd)))
      .groupBy(usageLogs.model)
      .orderBy(desc(drizzleSql`SUM(${usageLogs.costUsd}::numeric)`))
      .limit(3),
  ]);

  const orY = Number(orYesterday[0]?.sum ?? 0);
  const orM = Number(orMtd[0]?.sum ?? 0);

  // ===== 2b. WaveSpeed — single API call, look up yesterday + MTD =====
  let wsY = 0;
  let wsM = 0;
  let wsBal: number | null = null;
  if (WAVESPEED_API_KEY) {
    try {
      const r = await fetch('https://api.wavespeed.ai/api/v3/user/usage_stats', {
        body: JSON.stringify({
          end_date: yDate,
          per_model_usage: false,
          start_date: '2024-01-01',
        }),
        headers: {
          'Authorization': `Bearer ${WAVESPEED_API_KEY}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      if (r.ok) {
        const j = (await r.json()) as WaveSpeedUsageResp;
        const buckets = j.data?.daily_usage ?? [];
        const monthPrefix = yDate.slice(0, 7); // YYYY-MM
        for (const b of buckets) {
          if (b.date === yDate) wsY = b.amount;
          if (b.date.startsWith(monthPrefix)) wsM += b.amount;
        }
      }
      const bal = await fetch('https://api.wavespeed.ai/api/v3/balance', {
        headers: { Authorization: `Bearer ${WAVESPEED_API_KEY}` },
      });
      if (bal.ok) {
        const j = (await bal.json()) as { data?: { balance?: number } };
        wsBal = j.data?.balance ?? null;
      }
    } catch {
      // Swallow — Telegram alert still goes out, just without WS data.
    }
  }

  // ===== 2c. OpenRouter credits balance =====
  let orCredits: number | null = null;
  if (OPENROUTER_API_KEY) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/credits', {
        headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
      });
      if (r.ok) {
        const j = (await r.json()) as OpenRouterCreditsResp;
        const total = Number(j.data?.total_credits ?? 0);
        const used = Number(j.data?.total_usage ?? 0);
        orCredits = total - used;
      }
    } catch {
      // ignore
    }
  }

  // ===== 3. Subscriptions =====
  const [newSubsY, renewalsY, cancellationsY, activeSubs, mrrRow] = await Promise.all([
    db
      .select({ cnt: drizzleSql<number>`COUNT(*)::int`, planId: billingPayments.planId })
      .from(billingPayments)
      .where(
        and(
          eq(billingPayments.status, 'succeeded'),
          gte(billingPayments.createdAt, yStart),
          lt(billingPayments.createdAt, yEnd),
          drizzleSql`${billingPayments.type} = 'subscription'`,
        ),
      )
      .groupBy(billingPayments.planId),
    db
      .select({ cnt: drizzleSql<number>`COUNT(*)::int` })
      .from(billingPayments)
      .where(
        and(
          eq(billingPayments.status, 'succeeded'),
          gte(billingPayments.createdAt, yStart),
          lt(billingPayments.createdAt, yEnd),
          drizzleSql`${billingPayments.type} = 'auto_renewal'`,
        ),
      ),
    db
      .select({ cnt: drizzleSql<number>`COUNT(*)::int` })
      .from(userBilling)
      .where(and(gte(userBilling.cancelledAt, yStart), lt(userBilling.cancelledAt, yEnd))),
    db
      .select({ cnt: drizzleSql<number>`COUNT(*)::int` })
      .from(userBilling)
      .where(
        and(
          drizzleSql`${userBilling.subscriptionExpiresAt} > now()`,
          drizzleSql`${userBilling.planId} != 1`,
        ),
      ),
    db
      .select({ mrr: drizzleSql<number>`COALESCE(SUM(${billingPlans.priceRub}),0)::int` })
      .from(userBilling)
      .innerJoin(billingPlans, eq(billingPlans.id, userBilling.planId))
      .where(
        and(
          drizzleSql`${userBilling.subscriptionExpiresAt} > now()`,
          drizzleSql`${userBilling.planId} != 1`,
          drizzleSql`${userBilling.paymentMethodId} IS NOT NULL`,
          eq(userBilling.autoRenew, true),
          drizzleSql`${userBilling.cancelledAt} IS NULL`,
        ),
      ),
  ]);

  const newSubsTotal = newSubsY.reduce((a, r) => a + Number(r.cnt), 0);
  const renewalsCount = Number(renewalsY[0]?.cnt ?? 0);
  const cancellationsCount = Number(cancellationsY[0]?.cnt ?? 0);
  const activeCount = Number(activeSubs[0]?.cnt ?? 0);
  const mrr = Number(mrrRow[0]?.mrr ?? 0);
  const arpu = activeCount > 0 ? mrr / activeCount : 0;

  // ===== 4. Alerts =====
  const alerts: string[] = [];
  const [failedPayments, stuckAsync, topUser] = await Promise.all([
    db
      .select({ cnt: drizzleSql<number>`COUNT(*)::int` })
      .from(billingPayments)
      .where(
        and(
          eq(billingPayments.status, 'failed'),
          gte(billingPayments.createdAt, yStart),
          lt(billingPayments.createdAt, yEnd),
        ),
      ),
    // `async_tasks` is the unified queue used by image/video generation.
    // Anything still pending after 30 min is a stuck job — most often a
    // provider webhook that never fired.
    db.execute<{ cnt: number }>(
      drizzleSql`SELECT COUNT(*)::int AS cnt FROM async_tasks WHERE status='pending' AND created_at < now() - interval '30 minutes'`,
    ),
    db
      .select({
        user: usageLogs.userId,
        cost: drizzleSql<number>`COALESCE(SUM(${usageLogs.costUsd}::numeric),0)::float8`,
      })
      .from(usageLogs)
      .where(and(gte(usageLogs.createdAt, yStart), lt(usageLogs.createdAt, yEnd)))
      .groupBy(usageLogs.userId)
      .orderBy(desc(drizzleSql`SUM(${usageLogs.costUsd}::numeric)`))
      .limit(1),
  ]);

  const failedCnt = Number(failedPayments[0]?.cnt ?? 0);
  const stuckCnt = Number((stuckAsync as unknown as Array<{ cnt: number }>)[0]?.cnt ?? 0);
  const topUserCost = Number(topUser[0]?.cost ?? 0);
  const topUserId = topUser[0]?.user ?? null;
  const totalApiY = orY + wsY;

  if (failedCnt > 0) alerts.push(`⚠️ Failed payments: ${failedCnt}`);
  if (stuckCnt > 0) alerts.push(`⚠️ Stuck async tasks (>30 min): ${stuckCnt}`);
  if (wsBal !== null && wsBal < 5) alerts.push(`⚠️ WaveSpeed balance low: ${fmtUsd(wsBal)}`);
  if (orCredits !== null && orCredits < 10)
    alerts.push(`⚠️ OpenRouter credits low: ${fmtUsd(orCredits)}`);
  if (totalApiY > 0 && topUserCost / totalApiY > 0.5 && topUserId) {
    alerts.push(
      `⚠️ One user ate >50% of API: \`${escapeMd(topUserId.slice(0, 16))}…\` ${fmtUsd(topUserCost)}`,
    );
  }

  // ===== 5. Compose message =====
  const marginY = revY > 0 ? ((revY - totalApiY * USD_TO_RUB) / revY) * 100 : 0;
  const totalApiM = orM + wsM;
  const marginM = revM > 0 ? ((revM - totalApiM * USD_TO_RUB) / revM) * 100 : 0;

  const apiYRub = totalApiY * USD_TO_RUB;
  const momLine =
    momRatio === null
      ? null
      : `• vs пред. MTD: ${momRatio >= 1 ? '⬆️' : '⬇️'} ×${momRatio.toFixed(2)} (${fmtRub(revPM)})`;
  const topLines =
    topModelsY.length > 0
      ? [
          `🤖 *Топ-3 моделей вчера:*`,
          ...topModelsY.map(
            (m, i) =>
              `${i + 1}. \`${escapeMd((m.model ?? '?').slice(0, 40))}\` — ${fmtUsd(Number(m.cost))} (${m.cnt})`,
          ),
          '',
        ]
      : [];
  const alertLines = alerts.length > 0 ? ['', `🚨 *Алёрты:*`, ...alerts.map((a) => `• ${a}`)] : [];

  const lines: string[] = [
    `📊 *Отчёт за ${yDate}*`,
    '',
    `💰 *Деньги:*`,
    `• Выручка вчера: *${fmtRub(revY)}* (${revYCount} pmt)`,
    `• API вчера: ${fmtRub(apiYRub)} (OR ${fmtUsd(orY)} + WS ${fmtUsd(wsY)})`,
    `• Маржа вчера: *${fmtPct(marginY)}*`,
    '',
    `📅 *MTD ${yDate.slice(0, 7)}:*`,
    `• Выручка: *${fmtRub(revM)}* (${revMCount} pmt)`,
    `• API: ${fmtRub(totalApiM * USD_TO_RUB)} (OR ${fmtUsd(orM)} + WS ${fmtUsd(wsM)})`,
    `• Маржа: *${fmtPct(marginM)}*`,
    ...(momLine ? [momLine] : []),
    '',
    `👥 *Подписки:*`,
    `• Новые: ${newSubsTotal} | Продления: ${renewalsCount} | Отмены: ${cancellationsCount}`,
    `• Active: *${activeCount}* | MRR: ${fmtRub(mrr)} | ARPU: ${fmtRub(arpu)}`,
    '',
    ...topLines,
    `💳 *Балансы:*`,
    `• WaveSpeed: ${wsBal !== null ? fmtUsd(wsBal) : 'n/a'}`,
    `• OpenRouter: ${orCredits !== null ? fmtUsd(orCredits) : 'n/a'}`,
    ...alertLines,
  ];

  await sendAlert({
    body: lines.join('\n'),
    severity: 'info',
    title: `WebGPT daily — ${yDate}`,
  });

  return Response.json({
    durationMs: Date.now() - startedAt,
    ok: true,
    sent: true,
    summary: {
      activeSubs: activeCount,
      apiYRub,
      cancellations: cancellationsCount,
      marginY,
      mrr,
      newSubs: newSubsTotal,
      orY,
      renewals: renewalsCount,
      revM,
      revY,
      wsBal,
      wsY,
    },
    yDate,
  });
}
