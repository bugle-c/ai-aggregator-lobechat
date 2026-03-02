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
    console.log(
      `[billing] charged ${credits} credits: user=${userId} model=${modelId || 'unknown'} in=${tokensUsed} out=${outputTokens || 0}`,
    );
  } catch (error) {
    console.error('[billing] recordTokenUsage error:', error);
  }
}
