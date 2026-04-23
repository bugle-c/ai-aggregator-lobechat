import { and, eq, gte, sql } from 'drizzle-orm';

import { usageLogs } from '@/database/schemas/analytics';
import { type LobeChatDatabase } from '@/database/type';
import { BillingService } from '@/server/services/billing';

import { calculateCredits } from './model-rates';
import { classifyModelTier } from './model-tiers';

/**
 * Daily credit cap for PREMIUM-tier models on the Pro plan. Premium models
 * (claude-opus, chatgpt-4o-turbo) can burn $10+ in a few hours if unbounded,
 * which would exceed Pro's monthly revenue in a single session. Without this
 * cap, Pro gross margin becomes negative in the worst case.
 *
 * Default 1000 credits ≈ $1.50 real-cost/day ≈ $45/mo cost ceiling. Pro revenue
 * is 1490₽ ≈ $15/mo, so cap ≠ guaranteed profit, but it prevents one user
 * from single-handedly zeroing out the plan's margin.
 *
 * Override via env: PRO_PREMIUM_DAILY_CREDIT_CAP=<n>.
 */
export const PRO_PREMIUM_DAILY_CREDIT_CAP =
  Number(process.env.PRO_PREMIUM_DAILY_CREDIT_CAP) || 1000;

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

    // Premium-model daily cap (Pro only — Free/Basic already blocked by tier gating).
    // Prevents an Opus marathon from exceeding Pro's monthly revenue in one day.
    if (
      modelId &&
      plan?.slug === 'pro' &&
      classifyModelTier(modelId) === 'premium' &&
      PRO_PREMIUM_DAILY_CREDIT_CAP > 0
    ) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const premiumRows = await db
        .select({
          used: sql<number>`coalesce(sum(${usageLogs.creditsCharged}), 0)::int`,
        })
        .from(usageLogs)
        .where(
          and(
            eq(usageLogs.userId, userId),
            gte(usageLogs.createdAt, since),
            sql`${usageLogs.model} ILIKE 'claude-opus-%'`,
          ),
        );
      const premiumDayUsed = premiumRows[0]?.used ?? 0;
      if (premiumDayUsed >= PRO_PREMIUM_DAILY_CREDIT_CAP) {
        return {
          allowed: false,
          creditsRemaining: 0,
          message: `Дневной лимит на premium-модели (Opus) исчерпан: ${PRO_PREMIUM_DAILY_CREDIT_CAP} кредитов/24ч. Попробуйте более дешёвую модель или вернитесь завтра.`,
        };
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
  cacheWrite5mTokens?: number;
  cacheWrite1hTokens?: number;
  cacheReadTokens?: number;
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
    let credits: number;
    if (modelId && outputTokens !== undefined) {
      // Cache-aware pricing: compute credits from full breakdown including
      // cache_write_5m/1h (expensive, 1.25-2.0× input rate) and cache_read
      // (cheap, 0.1× input rate). Falling back to {input,output} still works.
      credits = calculateCredits(modelId, {
        inputTokens: tokensUsed,
        outputTokens,
        cacheWrite5mTokens: opts?.cacheWrite5mTokens ?? 0,
        cacheWrite1hTokens: opts?.cacheWrite1hTokens ?? 0,
        cacheReadTokens: opts?.cacheReadTokens ?? 0,
      });
    } else {
      // Legacy fallback: flat rate (for image/video that still use total tokens)
      credits = Math.max(1, Math.ceil(tokensUsed / 2500));
    }
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
