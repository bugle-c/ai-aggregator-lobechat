import { eq } from 'drizzle-orm';

import { getServerDB } from '@/database/core/db-adaptor';
import { creditHolds } from '@/database/schemas';
import { writeUsageLog } from '@/server/modules/analytics/writeUsageLog';
import { calculateCreditsAsync } from '@/server/modules/billing/model-rates';
import { BillingService } from '@/server/services/billing';
import { fetchRate } from '@/server/services/billing/rates-source';

interface ChargeParams {
  computePriceParams?: { generateAudio?: boolean };
  isError?: boolean;
  latency?: number;
  metadata: {
    asyncTaskId: string;
    generationBatchId: string;
    modelId: string;
    topicId?: string;
  };
  model: string;
  prechargeResult?: { amount: number; holdId: string } | Record<string, unknown>;
  provider: string;
  // Video: use durationSeconds from provider webhook if available, else fall back
  // to duration in modelUsage, else 0 (no charge, but we log it).
  usage?: { completionTokens: number; durationSeconds?: number; totalTokens: number };
  userId: string;
}

/**
 * Reconcile video generation against precharge hold (Pkg2).
 *
 * - `isError=true` + hold present: refund the held amount in full.
 * - Success + hold present: compute actual seconds × per-second rate,
 *   write the diff (`actual - held`), mark hold released, write usage_log.
 * - No hold (legacy path): just commit actual cost + log.
 *
 * All in one transaction so a write failure rolls back the counter delta.
 */
export async function chargeAfterGenerate(params: ChargeParams): Promise<void> {
  const heldAmount =
    params.prechargeResult && typeof (params.prechargeResult as any).amount === 'number'
      ? ((params.prechargeResult as any).amount as number)
      : 0;
  const holdId =
    params.prechargeResult && typeof (params.prechargeResult as any).holdId === 'string'
      ? ((params.prechargeResult as any).holdId as string)
      : null;

  const db = await getServerDB();

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
          `[billing] video refund ${heldAmount} credits on error: user=${params.userId}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
        console.error(`[billing] video refund failed — rolled back. user=${params.userId}: ${msg}`);
      }
    }
    return;
  }

  const seconds = params.usage?.durationSeconds ?? 0;
  if (seconds <= 0) {
    console.warn(
      `[billing] video chargeAfter: no durationSeconds for model=${params.metadata.modelId}, skipping charge`,
    );
    // Even though we have nothing to charge, the hold should be released
    // (otherwise it counts as "active" forever and skews active-hold sums).
    if (holdId && heldAmount > 0) {
      try {
        await db.transaction(async (tx) => {
          await new BillingService(tx as any, params.userId).incrementTokensUsed(
            -heldAmount,
            tx as any,
          );
          await tx
            .update(creditHolds)
            .set({ releasedAt: new Date() })
            .where(eq(creditHolds.id, holdId));
        });
      } catch (err) {
        console.error(
          `[billing] video hold release on no-duration failed: user=${params.userId}: ${(err as Error).message}`,
        );
      }
    }
    return;
  }

  // Defense-in-depth: re-validate the model is still configured as a video model.
  // Mirrors chargeBeforeGenerate gate. If the before-gate passed and the after-gate
  // fails, something changed mid-generation (admin deactivated / deleted / switched
  // pricing_unit). Skip charge and log loudly to avoid silent 1-credit fallback.
  const rate = await fetchRate(params.metadata.modelId);
  if (!rate || rate.modelId === '__default__' || rate.pricingUnit !== 'second') {
    console.error(
      `[billing] chargeAfter: model=${params.metadata.modelId} no longer configured for second, skipping charge to avoid silent under-charge. user=${params.userId}`,
    );
    return;
  }

  const credits = await calculateCreditsAsync(params.metadata.modelId, {
    kind: 'video',
    videoSeconds: seconds,
  });

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
        inputTokens: 0,
        kind: 'video',
        model: params.metadata.modelId,
        outputTokens: 0,
        provider: params.provider || 'unknown',
        userId: params.userId,
        videoSeconds: seconds,
      });
    });
  } catch (error) {
    const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
    console.error(
      `[billing] video charge transaction failed — rolled back. user=${params.userId} model=${params.metadata.modelId}: ${msg}`,
    );
    return;
  }

  console.info(
    `[billing] video charged ${credits} credits${heldAmount > 0 ? ` (held ${heldAmount}, diff ${diff})` : ''}: user=${params.userId} model=${params.metadata.modelId} seconds=${seconds}`,
  );
}
