import { getServerDB } from '@/database/core/db-adaptor';
import { creditHolds, type NewGeneration, type NewGenerationBatch } from '@/database/schemas';
import { checkUsageLimit } from '@/server/modules/billing/checkUsageLimit';
import { calculateCreditsAsync } from '@/server/modules/billing/model-rates';
import { isModelAllowedForPlanAsync } from '@/server/modules/billing/model-tiers';
import { type CreateImageServicePayload } from '@/server/routers/lambda/image';
import { BillingService } from '@/server/services/billing';
import { fetchRate } from '@/server/services/billing/rates-source';

interface ChargeParams {
  clientIp?: string | null;
  configForDatabase: CreateImageServicePayload['params'];
  generationParams: CreateImageServicePayload['params'];
  generationTopicId: string;
  imageNum: number;
  model: string;
  provider: string;
  userId: string;
}

type ChargeResult =
  | undefined
  | {
      data: {
        batch: NewGenerationBatch;
        generations: NewGeneration[];
      };
      success: true;
    };

/**
 * Pre-charge for image generation (Pkg2 — pre-charge architecture).
 *
 * 1. Strict catalog check: the model must be configured with `pricing_unit='image'`.
 * 2. Tier-gating (H4 fix): a curl with a valid session, even bypassing the
 *    UI, can no longer use a model above its plan tier.
 * 3. Daily/monthly cap check via `checkUsageLimit` (informational — the
 *    monthly hard guard is enforced atomically below).
 * 4. Real reservation (C2 + C1 fix): we compute the worst-case credit cost
 *    for this request, INSERT a row in credit_holds, and atomically
 *    increment `tokens_used_month` with a `limit` guard. The conditional
 *    UPDATE means concurrent requests CANNOT both succeed past the cap.
 *
 * Returns `{ prechargeResult }` so the caller embeds it in async_tasks.metadata
 * and `chargeAfterGenerate` can reconcile against the held amount.
 */
export async function chargeBeforeGenerate(params: ChargeParams): Promise<ChargeResult> {
  const db = await getServerDB();

  // Strict mode: image model must have an explicit row with pricing_unit='image'.
  // Never fall through to __default__ (token pricing can't bill per-image).
  const rate = await fetchRate(params.model);
  if (!rate || rate.modelId === '__default__' || rate.pricingUnit !== 'image') {
    throw new Error(
      `Model "${params.model}" is not configured for image generation. Admin: add it at /admin/finance/models.`,
    );
  }
  if (!rate.isActive) {
    throw new Error(`Model "${params.model}" is disabled.`);
  }

  // H4: tier-gating (curl bypass safe). Even with a valid session, free plan
  // cannot pre-charge a premium model.
  const billingService = new BillingService(db, params.userId);
  const planSlug = await billingService.getUserPlanSlug();
  const allowed = await isModelAllowedForPlanAsync(params.model, planSlug);
  if (!allowed) {
    throw new Error(`Модель "${params.model}" не доступна на плане "${planSlug}". Обновите план.`);
  }

  const result = await checkUsageLimit(db, params.userId, params.model);
  if (!result.allowed) {
    console.warn(`[billing] Image generation blocked for user ${params.userId}: ${result.message}`);
    throw new Error(result.message || 'Usage limit exceeded');
  }

  // Compute worst-case credits for this request. For images we charge
  // per-generated-image, so the upper bound is exactly imageNum.
  const maxCredits = await calculateCreditsAsync(params.model, {
    images: params.imageNum,
    kind: 'image',
  });

  // Atomic precharge: hold + conditional increment. If the increment would
  // overshoot the cap (concurrent requests racing past the cap), the
  // transaction throws and rolls back the hold insert too.
  const billing = await billingService.getOrResetUserBilling();
  const plan = await billingService.getPlanById(billing.planId);
  const monthlyCap = (plan?.tokenLimit ?? 0) + (billing.tokenBalance ?? 0);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(creditHolds).values({
        amount: maxCredits,
        reason: 'image-gen',
        userId: params.userId,
      });

      await new BillingService(tx as any, params.userId).incrementTokensUsed(
        maxCredits,
        tx as any,
        { limit: monthlyCap },
      );
    });
  } catch (err) {
    // Conditional UPDATE rejected — concurrent request bumped the counter
    // past the cap between checkUsageLimit and this transaction.
    console.warn(
      `[billing] Image precharge rejected for user=${params.userId} model=${params.model}: ${(err as Error).message}`,
    );
    throw new Error('Кредиты закончились. Пополните баланс или обновите план.');
  }

  // Image router does not pass prechargeResult downstream (signature is
  // intentionally `undefined | errorBatch` for backward-compat); the
  // `chargeAfterGenerate` for image instead looks up the oldest active
  // hold for this user+reason at reconcile time. See chargeAfterGenerate.
  return undefined;
}
