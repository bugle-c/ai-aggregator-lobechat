import { and, asc, eq, isNull } from 'drizzle-orm';

import { getServerDB } from '@/database/core/db-adaptor';
import { creditHolds } from '@/database/schemas';
import { writeUsageLog } from '@/server/modules/analytics/writeUsageLog';
import { calculateCreditsAsync } from '@/server/modules/billing/model-rates';
import { BillingService } from '@/server/services/billing';
import { fetchRate } from '@/server/services/billing/rates-source';
import { type ModelPerformance, type ModelUsage } from '@/types/index';

/**
 * Look up the oldest active image-gen hold for this user. Image router
 * does not thread asyncTaskId/holdId through to the post-charge step,
 * so we use a FIFO heuristic: the oldest unreleased hold for this user
 * with reason='image-gen' is the one that corresponds to the job that
 * just finished. Concurrent batches reconcile to wrong-but-equivalent
 * holds, but the user-level math stays consistent.
 */
async function findOldestActiveHold(
  db: any,
  userId: string,
  reason: string,
): Promise<{ id: string; amount: number } | null> {
  const rows = await db
    .select({ id: creditHolds.id, amount: creditHolds.amount })
    .from(creditHolds)
    .where(
      and(
        eq(creditHolds.userId, userId),
        eq(creditHolds.reason, reason),
        isNull(creditHolds.releasedAt),
      ),
    )
    .orderBy(asc(creditHolds.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

interface ChargeParams {
  imageNum?: number;
  isError?: boolean;
  metadata: {
    asyncTaskId: string;
    generationBatchId: string;
    modelId: string;
    topicId?: string;
  };
  metrics?: ModelPerformance;
  modelUsage?: ModelUsage;
  prechargeResult?: { amount: number; holdId: string } | Record<string, unknown>;
  provider: string;
  userId: string;
}

/**
 * Reconcile the image generation against any precharge hold (Pkg2).
 *
 * Three paths:
 * - `isError=true` + hold present: full refund (decrement counter by held
 *   amount, mark hold released).
 * - Success + hold present: compute actual cost, write the diff
 *   (`actual - held`), mark hold released, write usage_log.
 * - No hold present: legacy path (just commit actual cost + usage_log).
 *
 * All writes happen inside a single transaction so a usage_log insert
 * failure rolls back the counter delta — same guarantee as recordTokenUsage.
 */
export async function chargeAfterGenerate(params: ChargeParams): Promise<void> {
  const db = await getServerDB();

  // Resolve the hold for this generation. Two paths:
  // 1) Caller passed prechargeResult explicitly (test path / future router
  //    that threads it through async_tasks.metadata) — use those values.
  // 2) Otherwise, fall back to oldest-active-hold lookup keyed on
  //    (userId, reason='image-gen', released_at IS NULL). Image router
  //    doesn't currently propagate the hold id, so this is the production
  //    path until Pkg3 ships the metadata threading.
  let heldAmount =
    params.prechargeResult && typeof (params.prechargeResult as any).amount === 'number'
      ? ((params.prechargeResult as any).amount as number)
      : 0;
  let holdId =
    params.prechargeResult && typeof (params.prechargeResult as any).holdId === 'string'
      ? ((params.prechargeResult as any).holdId as string)
      : null;

  if (!holdId && heldAmount === 0) {
    const fallback = await findOldestActiveHold(db, params.userId, 'image-gen');
    if (fallback) {
      heldAmount = fallback.amount;
      holdId = fallback.id;
    }
  }

  // Error path: refund the full hold (if any), nothing else to do.
  if (params.isError) {
    if (heldAmount > 0) {
      try {
        await db.transaction(async (tx) => {
          await new BillingService(tx as any, params.userId).incrementTokensUsed(
            -heldAmount,
            tx as any,
          );
          if (holdId) {
            await tx
              .update(creditHolds)
              .set({ releasedAt: new Date() })
              .where(eq(creditHolds.id, holdId));
          }
        });
        console.info(
          `[billing] image refund ${heldAmount} credits on error: user=${params.userId}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
        console.error(`[billing] image refund failed — rolled back. user=${params.userId}: ${msg}`);
      }
    }
    return;
  }

  const imageNum = params.imageNum ?? 1;
  if (imageNum <= 0) return;

  // Defense-in-depth: re-validate the model is still configured as an image model.
  // Mirrors chargeBeforeGenerate gate. If the before-gate passed and the after-gate
  // fails, something changed mid-generation (admin deactivated / deleted / switched
  // pricing_unit). Skip charge and log loudly to avoid silent 1-credit fallback.
  const rate = await fetchRate(params.metadata.modelId);
  if (!rate || rate.modelId === '__default__' || rate.pricingUnit !== 'image') {
    console.error(
      `[billing] chargeAfter: model=${params.metadata.modelId} no longer configured for image, skipping charge to avoid silent under-charge. user=${params.userId}`,
    );
    return;
  }

  const credits = await calculateCreditsAsync(params.metadata.modelId, {
    images: imageNum,
    kind: 'image',
  });

  // Reconcile against the hold if one exists; otherwise legacy commit.
  const diff = heldAmount > 0 ? credits - heldAmount : credits;

  try {
    await db.transaction(async (tx) => {
      const billingService = new BillingService(tx as any, params.userId);
      if (diff !== 0) {
        await billingService.incrementTokensUsed(diff, tx as any);
      }
      if (holdId) {
        await tx
          .update(creditHolds)
          .set({ releasedAt: new Date() })
          .where(eq(creditHolds.id, holdId));
      }
      await writeUsageLog(tx, {
        creditsCharged: credits,
        images: imageNum,
        inputTokens: 0,
        kind: 'image',
        model: params.metadata.modelId,
        outputTokens: 0,
        provider: params.provider || 'unknown',
        userId: params.userId,
      });
    });
  } catch (error) {
    const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
    console.error(
      `[billing] image charge transaction failed — rolled back. user=${params.userId} model=${params.metadata.modelId}: ${msg}`,
    );
    return;
  }

  console.info(
    `[billing] image charged ${credits} credits${heldAmount > 0 ? ` (held ${heldAmount}, diff ${diff})` : ''}: user=${params.userId} model=${params.metadata.modelId} images=${imageNum}`,
  );
}
