import { getServerDB } from '@/database/core/db-adaptor';
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

/**
 * The hold taken for this batch. The lambda splits `amount` across the
 * batch's generations and stores each share in the async task metadata so
 * `chargeAfterGenerate` reconciles against THIS hold instead of guessing the
 * oldest active one (which double-charged users when two generations
 * overlapped, 2026-09-23).
 */
export interface ImagePrecharge {
  amount: number;
  holdId: string;
}

type ChargeResult = { prechargeResult: ImagePrecharge };

/**
 * Pre-charge for image generation (Pkg2 — pre-charge architecture).
 *
 * 1. Strict catalog check: the model must be configured with `pricing_unit='image'`.
 * 2. Tier-gating (H4 fix): a curl with a valid session, even bypassing the
 *    UI, can no longer use a model above its plan tier.
 * 3. Daily/monthly cap check via `checkUsageLimit` (informational — the
 *    monthly hard guard is enforced atomically below).
 * 4. Reserve credits atomically from expiring refunds and ordinary balance.
 *
 * Returns `{ prechargeResult: { holdId, amount } }`; the lambda splits the
 * amount per generation and embeds it in each async task (metadata + the
 * async call input) so `chargeAfterGenerate` reconciles against this hold.
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

  // kind='image': the free-plan daily *message* quota (EXP-003) gates chat only.
  const result = await checkUsageLimit(db, params.userId, params.model, { kind: 'image' });
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

  let holdId: string;
  try {
    const hold = await billingService.reserveCredits(maxCredits, 'image-gen');
    holdId = hold.id;
  } catch (err) {
    // Conditional UPDATE rejected — concurrent request bumped the counter
    // past the cap between checkUsageLimit and this transaction.
    console.warn(
      `[billing] Image precharge rejected for user=${params.userId} model=${params.model}: ${(err as Error).message}`,
    );
    throw new Error('Кредиты закончились. Пополните баланс или обновите план.');
  }

  if (!holdId) throw new Error('Credit reservation did not return a hold');
  return { prechargeResult: { amount: maxCredits, holdId } };
}
