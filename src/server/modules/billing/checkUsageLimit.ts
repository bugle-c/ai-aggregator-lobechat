import { and, eq, gte, inArray, sql } from 'drizzle-orm';

import { usageLogs } from '@/database/schemas/analytics';
import { type LobeChatDatabase } from '@/database/type';
import { BillingService } from '@/server/services/billing';

import { type Usage } from './compute-cost';
import { calculateCreditsAsync } from './model-rates';
import {
  classifyModelTierAsync,
  getModelsByTierAsync,
  type ModelTier,
  type PlanSlug,
} from './model-tiers';

/**
 * Per-plan × per-tier daily credit caps (last 24h rolling).
 *
 * Rationale: monthly `tokenLimit` alone can't protect a plan from a one-day
 * spend-marathon on premium/high-tier models. Caps bound the worst-case
 * daily cost against the plan's monthly revenue. Applies to ALL premium
 * providers (Anthropic Opus, OpenAI GPT-4 Turbo, future Opus versions,
 * anything at premium tier) — previously hardcoded to `claude-opus-%`.
 *
 * Numbers below assume 1 credit ≈ $0.0015 real cost. A tier cap of N credits
 * = N * $0.0015/day max real spend for that user on that tier.
 *
 * Override any cell via env: BILLING_CAP_{PLAN}_{TIER}=<n> (e.g.
 * BILLING_CAP_PRO_HIGH=5000). 0 disables the specific cap.
 */
type TierCapMap = Partial<Record<ModelTier, number>>;

function envCap(plan: PlanSlug, tier: ModelTier, fallback: number): number {
  const v = Number(process.env[`BILLING_CAP_${plan.toUpperCase()}_${tier.toUpperCase()}`]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

export const TIER_DAILY_CAPS: Record<PlanSlug, TierCapMap> = {
  // free/basic: cheap/mid models only (tier-gating blocks higher), and their
  // monthly + daily_credit_limit already bound spend — no per-tier cap needed.
  basic: {},
  free: {},
  // pro: 1490 ₽ ≈ $14.9/mo. Sonnet/GPT-4.1/Gemini Pro: cap to 3000 credits
  // (~$4.50/day → worst case $135/mo, still leaves margin from 8000-credit
  // monthly quota). Premium blocked by tier gating.
  pro: {
    high: envCap('pro', 'high', 3000),
  },
  // pro_max: 2990 ₽ ≈ $29.9/mo. Slightly looser high-tier cap; premium
  // (Opus, GPT-4 Turbo) capped so one session can't eat the whole plan.
  pro_max: {
    high: envCap('pro_max', 'high', 5000),
    premium: envCap('pro_max', 'premium', 2000),
  },
};

export interface UsageLimitResult {
  allowed: boolean;
  creditsRemaining?: number;
  message?: string;
}

export async function checkUsageLimit(
  db: LobeChatDatabase,
  userId: string,
  modelId?: string,
): Promise<UsageLimitResult> {
  try {
    const billingService = new BillingService(db, userId);
    const billing = await billingService.getOrResetUserBilling();
    const plan = await billingService.getPlanById(billing.planId);
    const creditLimit = plan?.tokenLimit || 50;
    const totalAvailable = creditLimit + billing.tokenBalance;

    // Per-tier daily caps: bound daily spend on premium/high-tier models
    // across ALL providers (Anthropic, OpenAI, Google, xAI, OpenRouter).
    // This replaces the previous `claude-opus-%` hardcode and catches any
    // future premium model automatically via classifyModelTier.
    if (modelId && plan?.slug) {
      const modelTier = await classifyModelTierAsync(modelId);
      const capMap = TIER_DAILY_CAPS[plan.slug as PlanSlug] ?? {};
      const tierCap = capMap[modelTier];
      if (tierCap && tierCap > 0) {
        const tierModels = await getModelsByTierAsync(modelTier);
        if (tierModels.length > 0) {
          const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const rows = await db
            .select({
              used: sql<number>`coalesce(sum(${usageLogs.creditsCharged}), 0)::int`,
            })
            .from(usageLogs)
            .where(
              and(
                eq(usageLogs.userId, userId),
                gte(usageLogs.createdAt, since),
                inArray(usageLogs.model, tierModels),
              ),
            );
          const tierDayUsed = rows[0]?.used ?? 0;
          if (tierDayUsed >= tierCap) {
            const tierLabel =
              modelTier === 'premium'
                ? 'premium (Opus, GPT-4 Turbo)'
                : modelTier === 'high'
                  ? 'high (Sonnet, Gemini Pro, GPT-4.1)'
                  : modelTier;
            return {
              allowed: false,
              creditsRemaining: 0,
              message: `Дневной лимит на ${tierLabel} модели исчерпан: ${tierCap} кредитов/24ч. Попробуйте более дешёвую модель или вернитесь завтра.`,
            };
          }
        }
      }
    }

    // Daily rate limit: guard against runaway spend on a single day.
    if (plan?.dailyCreditLimit != null) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const rows = await db
        .select({
          used: sql<number>`coalesce(sum(${usageLogs.creditsCharged}), 0)::int`,
        })
        .from(usageLogs)
        .where(and(eq(usageLogs.userId, userId), gte(usageLogs.createdAt, since)));
      const dayUsed = rows[0]?.used ?? 0;
      if (dayUsed >= plan.dailyCreditLimit) {
        return {
          allowed: false,
          creditsRemaining: 0,
          message: `Дневной лимит достигнут (${plan.dailyCreditLimit} кредитов / 24ч). Попробуйте завтра или обновите тариф.`,
        };
      }
    }

    if (billing.tokensUsedMonth >= totalAvailable) {
      return {
        allowed: false,
        creditsRemaining: 0,
        message: 'Кредиты закончились. Пополните баланс или обновите план.',
      };
    }

    return {
      allowed: true,
      creditsRemaining: totalAvailable - billing.tokensUsedMonth,
    };
  } catch (error) {
    console.error('[billing] checkUsageLimit error:', error);
    return { allowed: true }; // fail-open
  }
}

export interface RecordTokenUsageExtras {
  cacheReadTokens?: number;
  cacheWrite1hTokens?: number;
  cacheWrite5mTokens?: number;
  kind?: 'chat' | 'image' | 'video';
  provider?: string;
}

export async function recordTokenUsage(
  db: LobeChatDatabase,
  userId: string,
  tokensUsed: number,
  modelId?: string,
  outputTokens?: number,
  opts?: RecordTokenUsageExtras,
): Promise<void> {
  if (tokensUsed <= 0 && (!outputTokens || outputTokens <= 0)) return;
  try {
    const usage: Usage = {
      kind: 'chat',
      tokens: {
        inputTokens: tokensUsed,
        outputTokens: outputTokens ?? 0,
        cacheWrite5mTokens: opts?.cacheWrite5mTokens ?? 0,
        cacheWrite1hTokens: opts?.cacheWrite1hTokens ?? 0,
        cacheReadTokens: opts?.cacheReadTokens ?? 0,
      },
    };
    const credits = modelId
      ? await calculateCreditsAsync(modelId, usage)
      : Math.max(1, Math.ceil(tokensUsed / 2500));

    const billingService = new BillingService(db, userId);
    await billingService.incrementTokensUsed(credits);

    // Also log the raw request for v3 analytics + the cost audit.
    const { writeUsageLog } = await import('@/server/modules/analytics/writeUsageLog');
    await writeUsageLog(db, {
      userId,
      model: modelId || 'unknown',
      provider: opts?.provider || 'unknown',
      inputTokens: tokensUsed,
      outputTokens: outputTokens ?? 0,
      cacheWrite5mTokens: opts?.cacheWrite5mTokens ?? 0,
      cacheWrite1hTokens: opts?.cacheWrite1hTokens ?? 0,
      cacheReadTokens: opts?.cacheReadTokens ?? 0,
      creditsCharged: credits,
      kind: opts?.kind || 'chat',
    });

    console.info(
      `[billing] charged ${credits} credits: user=${userId} model=${modelId || 'unknown'} in=${tokensUsed} out=${outputTokens || 0} cw5m=${opts?.cacheWrite5mTokens ?? 0} cw1h=${opts?.cacheWrite1hTokens ?? 0} cr=${opts?.cacheReadTokens ?? 0}`,
    );
  } catch (error) {
    const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
    console.error(`[billing] recordTokenUsage FAIL user=${userId}: ${msg}`);
  }
}
