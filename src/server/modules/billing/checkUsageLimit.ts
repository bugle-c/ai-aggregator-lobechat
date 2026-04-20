import { and, eq, gte, sql } from 'drizzle-orm';

import { usageLogs } from '@/database/schemas/analytics';
import { type LobeChatDatabase } from '@/database/type';
import { BillingService } from '@/server/services/billing';

import { calculateCredits } from './model-rates';

export interface UsageLimitResult {
  allowed: boolean;
  creditsRemaining?: number;
  message?: string;
}

export async function checkUsageLimit(
  db: LobeChatDatabase,
  userId: string,
): Promise<UsageLimitResult> {
  try {
    const billingService = new BillingService(db, userId);
    const billing = await billingService.getOrResetUserBilling();
    const plan = await billingService.getPlanById(billing.planId);
    const creditLimit = plan?.tokenLimit || 50;
    const totalAvailable = creditLimit + billing.tokenBalance;

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

export async function recordTokenUsage(
  db: LobeChatDatabase,
  userId: string,
  tokensUsed: number,
  modelId?: string,
  outputTokens?: number,
  opts?: { provider?: string; kind?: 'chat' | 'image' | 'video' },
): Promise<void> {
  if (tokensUsed <= 0 && (!outputTokens || outputTokens <= 0)) return;
  try {
    let credits: number;
    if (modelId && outputTokens !== undefined) {
      // Per-model pricing: calculate from actual input/output tokens
      credits = calculateCredits(modelId, tokensUsed, outputTokens);
    } else {
      // Legacy fallback: flat rate (for image/video that still use total tokens)
      credits = Math.max(1, Math.ceil(tokensUsed / 2500));
    }
    const billingService = new BillingService(db, userId);
    await billingService.incrementTokensUsed(credits);

    // Also log the raw request for v3 analytics (non-blocking on error).
    const { writeUsageLog } = await import('@/server/modules/analytics/writeUsageLog');
    await writeUsageLog(db, {
      userId,
      model: modelId || 'unknown',
      provider: opts?.provider || 'unknown',
      inputTokens: tokensUsed,
      outputTokens: outputTokens ?? 0,
      creditsCharged: credits,
      kind: opts?.kind || 'chat',
    });

    console.info(
      `[billing] charged ${credits} credits: user=${userId} model=${modelId || 'unknown'} in=${tokensUsed} out=${outputTokens || 0}`,
    );
  } catch (error) {
    console.error('[billing] recordTokenUsage error:', error);
  }
}
