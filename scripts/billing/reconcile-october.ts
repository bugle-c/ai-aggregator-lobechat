import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { and, eq, gt, gte, inArray, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { z } from 'zod';

import * as schema from '../../packages/database/src/schemas';
import type { LobeChatDatabase } from '../../packages/database/src/type';
import { BillingService } from '../../src/server/services/billing';
import { historicalPricingSchema } from '../../src/server/modules/billing/historical-pricing';

const evidenceSchema = z.object({
  usageId: z.string().uuid(), userId: z.string().min(1), provider: z.string().min(1),
  providerRequestId: z.string().min(1), source: z.enum(['openrouter_generation', 'wavespeed_billings', 'upstream_usage']),
  actualUsd: z.number().finite().nonnegative(),
  // Archived request-time pricing is mandatory; today's catalog is not evidence.
  pricing: historicalPricingSchema,
});
const reportSchema = z.object({ campaign: z.string().min(1), fixCutoff: z.string().datetime(),
  backupReference: z.string().min(1), rows: z.array(evidenceSchema) });

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args.find((arg) => !arg.startsWith('--'));
  if (!inputPath) throw new Error('Usage: bun scripts/billing/reconcile-october.ts evidence.json [--apply --reviewed-sha256=HASH]');
  const raw = await readFile(inputPath);
  const digest = createHash('sha256').update(raw).digest('hex');
  const report = reportSchema.parse(JSON.parse(raw.toString('utf8')));
  const apply = args.includes('--apply');
  if (apply && !args.includes(`--reviewed-sha256=${digest}`)) throw new Error('Apply requires the exact reviewed dry-run SHA256');
  const cutoff = new Date(report.fixCutoff);
  const start = new Date('2026-09-30T21:00:00Z');
  if (cutoff <= start || cutoff > new Date()) throw new Error('Invalid production fix cutoff');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Same PostgreSQL/Drizzle schema as the service; no production connection is selected by this script.
  const db = drizzle(pool, { schema }) as unknown as LobeChatDatabase;
  try {
    const eligiblePayments = await db.select({ userId: schema.billingPayments.userId }).from(schema.billingPayments).where(and(
      eq(schema.billingPayments.status, 'succeeded'), gt(schema.billingPayments.amountRub, 0),
      inArray(schema.billingPayments.type, ['subscription', 'topup']),
      gte(schema.billingPayments.createdAt, start), lt(schema.billingPayments.createdAt, cutoff)));
    const eligibleUserIds = [...new Set(eligiblePayments.map((payment) => payment.userId))];
    const cohort = eligibleUserIds.length ? await db.select().from(schema.usageLogs).where(and(
      inArray(schema.usageLogs.userId, eligibleUserIds), gte(schema.usageLogs.createdAt, start), lt(schema.usageLogs.createdAt, cutoff))) : [];
    const groups = new Map<string, Array<{ usageId: string; correctedCredits: number; evidence: { source: string; reference: string; pricing: string } }>>();
    const results: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    for (const row of report.rows) {
      if (seen.has(row.usageId)) throw new Error(`Duplicate usage ID ${row.usageId}`);
      seen.add(row.usageId);
      if (!eligibleUserIds.includes(row.userId)) throw new Error(`Evidence user outside eligible cohort: ${row.userId}`);
      const archivedPricing = historicalPricingSchema.safeParse(cohort.find((usage) => usage.id === row.usageId)?.providerCostEvidence?.historicalPricing);
      const archived = archivedPricing.success ? archivedPricing.data : undefined;
      const [usage] = await db.select().from(schema.usageLogs).where(and(eq(schema.usageLogs.id, row.usageId),
        eq(schema.usageLogs.userId, row.userId), gte(schema.usageLogs.createdAt, start), lt(schema.usageLogs.createdAt, cutoff)));
      // Exact archived identity and independently reconciled amount must agree. Input JSON alone cannot establish actual expense.
      if (!usage || usage.provider !== row.provider || usage.providerRequestId !== row.providerRequestId ||
        usage.kind !== 'chat' || usage.providerCostStatus !== 'verified' || usage.actualProviderCostUsd === null ||
        Number(usage.actualProviderCostUsd) !== row.actualUsd || usage.providerCostSource !== row.source ||
        Number(usage.exchangeRate) !== row.pricing.exchangeRate ||
        !archived || row.pricing.captureStage === 'usage_log_write' ||
        Object.entries(row.pricing).some(([key, value]) => Reflect.get(archived, key) !== value)) {
        results.push({ userId: row.userId, usageId: row.usageId, status: 'unresolved', reason: 'Exact verified provider evidence or historical FX missing/mismatched' });
        continue;
      }
      const [existing] = await db.select({ id: schema.usageCreditCorrections.id }).from(schema.usageCreditCorrections).where(and(
        eq(schema.usageCreditCorrections.campaign, report.campaign), eq(schema.usageCreditCorrections.usageId, row.usageId)));
      if (existing) { results.push({ userId: row.userId, usageId: row.usageId, status: 'already-corrected', refund: 0 }); continue; }
      const correctedCredits = row.actualUsd === 0 ? row.pricing.zeroCostCredits : Math.max(row.pricing.minimumCredits,
        Math.ceil(row.actualUsd * row.pricing.markup * row.pricing.exchangeRate / row.pricing.creditValueRub));
      const refund = Math.max(0, usage.creditsCharged - correctedCredits);
      results.push({ userId: row.userId, usageId: row.usageId, originalCredits: usage.creditsCharged, correctedCredits, refund,
        actualUsd: row.actualUsd, status: refund ? 'proposed' : 'unchanged' });
      if (!refund) continue;
      const corrections = groups.get(row.userId) ?? [];
      corrections.push({ usageId: row.usageId, correctedCredits, evidence: { source: row.source,
        reference: row.providerRequestId, pricing: JSON.stringify({ ...row.pricing, actualUsd: row.actualUsd, reviewedReport: digest, backupReference: report.backupReference }) } });
      groups.set(row.userId, corrections);
    }
    for (const usage of cohort) {
      if (!seen.has(usage.id)) results.push({ userId: usage.userId, usageId: usage.id, originalCredits: usage.creditsCharged,
        status: 'unresolved', reason: 'No reviewed exact request evidence and historical pricing supplied' });
    }
    const grants: Array<Record<string, unknown>> = [];
    for (const [userId, corrections] of groups) {
      const [payment] = await db.select({ id: schema.billingPayments.id }).from(schema.billingPayments).where(and(
        eq(schema.billingPayments.userId, userId), eq(schema.billingPayments.status, 'succeeded'),
        gt(schema.billingPayments.amountRub, 0), inArray(schema.billingPayments.type, ['subscription', 'topup']),
        gte(schema.billingPayments.createdAt, start), lt(schema.billingPayments.createdAt, cutoff)));
      if (!payment) { grants.push({ userId, status: 'ineligible' }); continue; }
      const proposedCredits = corrections.reduce((sum, correction) => {
        const result = results.find((item) => item.usageId === correction.usageId);
        return sum + Number(result?.refund ?? 0);
      }, 0);
      grants.push({ userId, proposedCredits, ...(apply ? await new BillingService(db, userId).grantRefundCorrections({
        campaign: report.campaign, fixCutoff: cutoff, corrections,
      }) : { status: 'dry-run' }) });
    }
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', sha256: digest, campaign: report.campaign,
      cohort: { eligibleUsers: eligibleUserIds.length, usageRows: cohort.length,
        evidencedRows: seen.size, unresolvedUsageIds: results.filter((row) => row.status === 'unresolved').map((row) => row.usageId) },
      fixCutoff: report.fixCutoff, backupReference: report.backupReference, results, grants }, null, 2));
  } finally { await pool.end(); }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
