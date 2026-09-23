import { getMediaRouterConfig } from '@/business/server/media-router/config';
import { videoRouteFor } from '@/business/server/media-router/eligibility';
import {
  FREE_VIDEO_QUEUE_MESSAGE,
  FREE_VIDEO_TRIAL_MODELS,
  getFreeVideoTrial,
} from '@/business/server/media-router/newcomer';
import { getServerDB } from '@/database/core/db-adaptor';
import { creditHolds, type NewGeneration, type NewGenerationBatch } from '@/database/schemas';
import { activeBonusFor } from '@/server/modules/billing/active-bonus';
import { checkUsageLimit } from '@/server/modules/billing/checkUsageLimit';
import { referenceSecondsFor } from '@/server/modules/billing/compute-cost';
import { FREE_PLAN_SLUG } from '@/server/modules/billing/daily-quota';
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
  /** The free-plan «одно видео» trial admitted this request (must be pool-rendered). */
  freeTrial?: boolean;
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
  let allowed = await isModelAllowedForPlanAsync(params.model, planSlug);
  let freeTrial = false;
  if (!allowed && planSlug === FREE_PLAN_SLUG && FREE_VIDEO_TRIAL_MODELS.has(params.model)) {
    // «Одно видео на Free»: image→video on a pool model, paid in credits as
    // usual, rendered by the router pool. Refused (before any hold) when the
    // request is not pool-eligible or the pool cannot take it right now.
    const trial = await getFreeVideoTrial(db, params.userId, planSlug);
    if (trial.left > 0) {
      const route = videoRouteFor(
        params.model,
        params.params as any,
        planSlug,
        getMediaRouterConfig().videoPlans,
      );
      if (!route || !route.image) {
        throw new Error(
          'Бесплатное видео на «Старт»: оживите свою картинку — Veo 3.1 Fast, 4–8 секунд, 720p, 16:9 или 9:16.',
        );
      }
      if (!trial.available) throw new Error(FREE_VIDEO_QUEUE_MESSAGE);
      allowed = true;
      freeTrial = true;
    }
  }
  if (!allowed) {
    throw new Error(`Модель "${params.model}" не доступна на плане "${planSlug}". Обновите план.`);
  }

  // kind='video': the free-plan daily *message* quota (EXP-003) gates chat only.
  const result = await checkUsageLimit(db, params.userId, params.model, { kind: 'video' });
  if (!result.allowed) {
    console.warn(`[billing] Video generation blocked for user ${params.userId}: ${result.message}`);
    throw new Error(result.message || 'Usage limit exceeded');
  }

  // Worst-case seconds: explicit duration ?? fallback default cap.
  const requestedDuration =
    typeof params.params.duration === 'number' && params.params.duration > 0
      ? params.params.duration
      : MAX_DEFAULT_VIDEO_SECONDS;
  const requestedResolution =
    typeof params.params.resolution === 'string' ? params.params.resolution : undefined;
  // Reference videos are billed at the output rate on top of the output.
  const referenceSeconds = referenceSecondsFor(
    params.params as { referenceSeconds?: number; videoUrls?: unknown[] },
  );
  const maxCredits = await calculateCreditsAsync(params.model, {
    kind: 'video',
    resolution: requestedResolution,
    videoSeconds: requestedDuration + referenceSeconds,
  });

  // Atomic precharge: hold + conditional increment with monthly cap guard (C1).
  const billing = await billingService.getOrResetUserBilling();
  const plan = await billingService.getPlanById(billing.planId);
  const monthlyCap =
    (plan?.tokenLimit ?? 0) + (billing.tokenBalance ?? 0) + activeBonusFor(billing);

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

  return { freeTrial, prechargeResult: { amount: maxCredits, holdId } };
}
