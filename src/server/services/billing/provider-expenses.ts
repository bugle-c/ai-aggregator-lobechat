import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { providerExpenseDaily, usageLogs } from '@/database/schemas/analytics';
import { type LobeChatDatabase } from '@/database/type';

export interface WaveSpeedOperation {
  uuid: string;
  billing_type: string;
  price: number;
  prediction?: { uuid: string };
  order?: { uuid: string; state: string };
}

const operationSchema = z.object({
  uuid: z.string().min(1),
  billing_type: z.string().min(1),
  price: z.number().finite().nonnegative(),
  prediction: z.object({ uuid: z.string().min(1) }).passthrough().optional(),
  order: z.object({ uuid: z.string().min(1), state: z.string().min(1) }).passthrough().optional(),
}).passthrough();
const billingResponseSchema = z.object({
  code: z.literal(200),
  data: z.object({ items: z.array(operationSchema), has_more: z.boolean() }),
});

/** Exact prediction lookup, never organization-wide spend allocated to users. */
export async function fetchWaveSpeedOperations(ids: string[], key: string): Promise<WaveSpeedOperation[]> {
  if (ids.length === 0 || ids.length > 10) throw new Error('Expected 1–10 prediction IDs');
  const operations = new Map<string, WaveSpeedOperation>();
  for (let page = 1; ; page++) {
    const response = await fetch('https://api.wavespeed.ai/api/v3/billings/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prediction_uuids: ids, page, page_size: 100 }),
    });
    if (!response.ok) throw new Error(`WaveSpeed billings HTTP ${response.status}`);
    const parsed = billingResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('Invalid WaveSpeed operation response');
    const body = parsed.data;
    for (const operation of body.data.items) {
      const previous = operations.get(operation.uuid);
      if (previous && JSON.stringify(previous) !== JSON.stringify(operation)) throw new Error('Conflicting billing operation UUID');
      operations.set(operation.uuid, operation);
    }
    if (!body.data.has_more) return [...operations.values()];
    if (body.data.items.length === 0) throw new Error('Empty WaveSpeed page with has_more');
  }
}

export interface ResolvedWaveSpeedExpense {
  costUsd: number;
  evidence: { operations: WaveSpeedOperation[] };
}

export function resolveWaveSpeedCost(id: string, operations: WaveSpeedOperation[]): ResolvedWaveSpeedExpense | null {
  const matched = [...new Map(operations.filter((item) => item.prediction?.uuid === id).map((item) => [item.uuid, item])).values()];
  if (matched.length === 0) return null;
  if (matched.some((item) => !item.uuid || !Number.isFinite(item.price) || item.price < 0)) return null;
  // Observed financial types: deduct and refund (positive refund price).
  // Unknown/reservation operations are not silently interpreted as final charges.
  if (matched.some((item) => item.order && !['done', 'refunded'].includes(item.order.state))) return null;
  if (matched.some((item) => !['deduct', 'refund'].includes(item.billing_type))) return null;
  if (!matched.some((item) => item.billing_type === 'deduct')) return null;
  const cost = matched.reduce((sum, item) => sum + (item.billing_type === 'refund' ? -item.price : item.price), 0);
  if (cost < -1e-10) return null;
  return { costUsd: Math.max(0, cost), evidence: { operations: matched } };
}

export function expenseCoverage(totalRequests: number, verifiedRequests: number, refreshedRequests: number) {
  return {
    verifiedRequests,
    unresolvedRequests: totalRequests - verifiedRequests,
    status: totalRequests === verifiedRequests && refreshedRequests === verifiedRequests ? 'verified' : 'partial',
  };
}

export async function reconcileWaveSpeedExpenses(db: LobeChatDatabase, key: string) {
  // Revisit verified rows too: refunds can be posted after completion.
  const rows = await db.select({ id: usageLogs.id, requestId: usageLogs.providerRequestId, createdAt: usageLogs.createdAt,
    actualUsd: usageLogs.actualProviderCostUsd, expenseStatus: usageLogs.providerCostStatus, evidence: usageLogs.providerCostEvidence })
    .from(usageLogs).where(eq(usageLogs.provider, 'wavespeed'));
  const ids = [...new Set(rows.flatMap((row) => row.requestId ? [row.requestId] : []))];
  let reconciled = 0;
  const resolvedCosts = new Map<string, ResolvedWaveSpeedExpense>();
  for (let offset = 0; offset < ids.length; offset += 10) {
    const batch = ids.slice(offset, offset + 10);
    const operations = await fetchWaveSpeedOperations(batch, key);
    for (const id of batch) {
      const resolved = resolveWaveSpeedCost(id, operations);
      if (!resolved) continue;
      // Ambiguous local attribution is left unresolved instead of charging twice.
      const matches = rows.filter((row) => row.requestId === id);
      if (matches.length !== 1) continue;
      resolvedCosts.set(id, resolved);
      await db.update(usageLogs).set({
        actualProviderCostUsd: String(resolved.costUsd),
        providerCostStatus: 'verified',
        providerCostSource: 'wavespeed_billings',
        providerCostEvidence: sql`coalesce(${usageLogs.providerCostEvidence}, '{}'::jsonb) || ${JSON.stringify(resolved.evidence)}::jsonb`,
        providerCostReconciledAt: new Date(),
      }).where(eq(usageLogs.id, matches[0].id));
      reconciled++;
    }
  }
  const daily = [];
  for (const day of new Set(rows.map((row) => row.createdAt.toISOString().slice(0, 10)))) {
    const dayRows = rows.filter((row) => row.createdAt.toISOString().slice(0, 10) === day);
    const verified = dayRows.flatMap((row) => {
      const fresh = row.requestId ? resolvedCosts.get(row.requestId) : null;
      const archived = row.expenseStatus === 'verified' && row.actualUsd !== null
        ? { costUsd: Number(row.actualUsd), evidence: row.evidence ?? {} } : null;
      const cost = fresh ?? archived;
      return cost ? [{ requestId: row.requestId, ...cost, refreshed: fresh !== null && fresh !== undefined }] : [];
    });
    // Preserve known financial amounts, but coverage always reflects current local rows.
    const value = {
      provider: 'wavespeed', day, scope: 'exact_application_predictions',
      actualUsd: String(verified.reduce((sum, row) => sum + row.costUsd, 0)),
      ...expenseCoverage(dayRows.length, verified.length, verified.filter((row) => row.refreshed).length),
      evidence: { requests: verified }, updatedAt: new Date(),
    };
    await db.insert(providerExpenseDaily).values(value).onConflictDoUpdate({
      target: [providerExpenseDaily.provider, providerExpenseDaily.day, providerExpenseDaily.scope],
      set: value,
    });
    daily.push(value);
  }
  return { requests: ids.length, reconciled, daily };
}
