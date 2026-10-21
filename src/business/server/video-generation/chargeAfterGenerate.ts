import { getServerDB } from '@/database/core/db-adaptor';
import { writeUsageLog } from '@/server/modules/analytics/writeUsageLog';
import { calculateCreditsAsync } from '@/server/modules/billing/model-rates';
import { BillingService } from '@/server/services/billing';
import { fetchRate } from '@/server/services/billing/rates-source';

interface ChargeParams {
  computePriceParams?: { generateAudio?: boolean };
  inferenceId?: string;
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
  /** Billable seconds of the reference videos (from the batch config), already clamped. */
  referenceSeconds?: number;
  /** Requested output resolution (from the batch config) — per-resolution families bill by it. */
  resolution?: string | null;
  /** Actual renderer when not the catalog provider (llm-router pool → providerCostUsd 0). */
  served?: { provider: string; providerCostUsd: number };
  // Video: use durationSeconds from provider webhook if available, else fall back
  // to duration in modelUsage, else 0 (no charge, but we log it).
  usage?: { completionTokens: number; durationSeconds?: number; totalTokens: number };
  userId: string;
}

/** Settle source-aware reservations and record the actual funded debit. */
export async function chargeAfterGenerate(params: ChargeParams): Promise<void> {
  const heldAmount =
    params.prechargeResult && typeof params.prechargeResult.amount === 'number'
      ? params.prechargeResult.amount
      : 0;
  const holdId =
    params.prechargeResult && typeof params.prechargeResult.holdId === 'string'
      ? params.prechargeResult.holdId
      : null;

  const db = await getServerDB();

  if (params.isError) {
    if (heldAmount > 0) {
      try {
        const refunded = await db.transaction(async (tx) => {
          if (!holdId) return false;
          const result = await new BillingService(tx, params.userId).settleCreditHold(holdId, 0, tx);
          return result.settled;
        });
        console.info(
          refunded
            ? `[billing] video refund ${heldAmount} credits on error: user=${params.userId}`
            : `[billing] video refund skipped — hold ${holdId} already released: user=${params.userId}`,
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
          await new BillingService(tx, params.userId).settleCreditHold(holdId, 0, tx);
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
    resolution: params.resolution,
    videoSeconds: seconds + (params.referenceSeconds ?? 0),
  });


  try {
    await db.transaction(async (tx) => {
      const billingService = new BillingService(tx, params.userId);
      const reservation = holdId
        ? { id: holdId }
        : await billingService.reserveCredits(credits, 'video-gen', params.metadata.asyncTaskId, tx);
      const result = await billingService.settleCreditHold(reservation.id, credits, tx);
      if (!result.settled) return;
      await writeUsageLog(tx, {
        creditsCharged: result.committed,
        inputTokens: 0,
        kind: 'video',
        model: params.metadata.modelId,
        outputTokens: 0,
        provider: params.served?.provider ?? (params.provider || 'unknown'),
        providerCostUsd: params.served?.providerCostUsd,
        providerRequestId: params.inferenceId,
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
    `[billing] video settlement processed: user=${params.userId} model=${params.metadata.modelId} seconds=${seconds}`,
  );
}
