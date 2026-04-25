import { getServerDB } from '@/database/core/db-adaptor';
import { creditHolds, type NewGeneration, type NewGenerationBatch } from '@/database/schemas';
import { checkUsageLimit } from '@/server/modules/billing/checkUsageLimit';
import { calculateCreditsAsync } from '@/server/modules/billing/model-rates';
import { isModelAllowedForPlanAsync } from '@/server/modules/billing/model-tiers';
import type { CreateVideoServicePayload } from '@/server/routers/lambda/video';
import { BillingService } from '@/server/services/billing';
import { fetchRate } from '@/server/services/billing/rates-source';

interface ChargeParams {
  generationTopicId: string;
  model: string;
  params: CreateVideoServicePayload['params'];
  provider: string;
  userId: string;
}

interface ErrorBatch {
  data: {
    batch: NewGenerationBatch;
    generations: NewGeneration[];
  };
  success: true;
}

interface ChargeBeforeResult {
  errorBatch?: ErrorBatch;
  prechargeResult?: { amount: number; holdId: string };
}

// Worst-case duration when the request omits one. Real video models all
// stop at <= 10s for free / standard tiers; we hold for a generous upper
// bound so the conditional UPDATE catches over-budget callers.
const MAX_DEFAULT_VIDEO_SECONDS = 10;

/**
 * Pre-charge for video generation (Pkg2 — pre-charge architecture).
 *
 * Mirrors image's chargeBeforeGenerate. Differences:
 * - upper-bound credits computed as `max(duration, fallback) * perUnit * markup`
 *   so we hold enough even when the provider extends the clip.
 * - returns {amount, holdId} which the lambda router persists into
 *   asyncTasks.metadata.precharge — the webhook handler then passes it back
 *   to chargeAfterGenerate for reconciliation/refund.
 */
export async function chargeBeforeGenerate(params: ChargeParams): Promise<ChargeBeforeResult> {
  const db = await getServerDB();

  const rate = await fetchRate(params.model);
  if (!rate || rate.modelId === '__default__' || rate.pricingUnit !== 'second') {
    throw new Error(
      `Model "${params.model}" is not configured for video generation. Admin: add it at /admin/finance/models.`,
    );
  }
  if (!rate.isActive) {
    throw new Error(`Model "${params.model}" is disabled.`);
  }

  // H4 fix: tier-gating enforced server-side regardless of UI state.
  const billingService = new BillingService(db, params.userId);
  const planSlug = await billingService.getUserPlanSlug();
  const allowed = await isModelAllowedForPlanAsync(params.model, planSlug);
  if (!allowed) {
    throw new Error(`Модель "${params.model}" не доступна на плане "${planSlug}". Обновите план.`);
  }

  const result = await checkUsageLimit(db, params.userId, params.model);
  if (!result.allowed) {
    console.warn(`[billing] Video generation blocked for user ${params.userId}: ${result.message}`);
    throw new Error(result.message || 'Usage limit exceeded');
  }

  // Worst-case seconds: explicit duration ?? fallback default cap.
  const requestedDuration =
    typeof params.params.duration === 'number' && params.params.duration > 0
      ? params.params.duration
      : MAX_DEFAULT_VIDEO_SECONDS;
  const maxCredits = await calculateCreditsAsync(params.model, {
    kind: 'video',
    videoSeconds: requestedDuration,
  });

  // Atomic precharge: hold + conditional increment with monthly cap guard (C1).
  const billing = await billingService.getOrResetUserBilling();
  const plan = await billingService.getPlanById(billing.planId);
  const monthlyCap = (plan?.tokenLimit ?? 0) + (billing.tokenBalance ?? 0);

  let holdId: string;
  try {
    holdId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(creditHolds)
        .values({
          amount: maxCredits,
          reason: 'video-gen',
          userId: params.userId,
        })
        .returning({ id: creditHolds.id });
      const newId = inserted[0]!.id;

      await new BillingService(tx as any, params.userId).incrementTokensUsed(
        maxCredits,
        tx as any,
        { limit: monthlyCap },
      );

      return newId;
    });
  } catch (err) {
    console.warn(
      `[billing] Video precharge rejected for user=${params.userId} model=${params.model}: ${(err as Error).message}`,
    );
    throw new Error('Кредиты закончились. Пополните баланс или обновите план.');
  }

  return { prechargeResult: { amount: maxCredits, holdId } };
}
