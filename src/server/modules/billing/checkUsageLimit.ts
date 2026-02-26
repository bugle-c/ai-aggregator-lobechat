import { type LobeChatDatabase } from '@/database/type';
import { BillingService } from '@/server/services/billing';

export interface UsageLimitResult {
  allowed: boolean;
  message?: string;
  remainingTokens?: number;
}

export async function checkUsageLimit(
  db: LobeChatDatabase,
  userId: string,
): Promise<UsageLimitResult> {
  try {
    const billingService = new BillingService(db, userId);
    const billing = await billingService.getOrResetUserBilling();
    const plan = await billingService.getPlanById(billing.planId);
    const tokenLimit = plan?.tokenLimit || 50000;
    const totalAvailable = tokenLimit + billing.tokenBalance;

    if (billing.tokensUsedMonth >= totalAvailable) {
      return {
        allowed: false,
        message: 'Лимит токенов исчерпан. Пополните баланс или обновите план.',
        remainingTokens: 0,
      };
    }

    return {
      allowed: true,
      remainingTokens: totalAvailable - billing.tokensUsedMonth,
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
): Promise<void> {
  if (tokensUsed <= 0) return;
  try {
    const billingService = new BillingService(db, userId);
    await billingService.incrementTokensUsed(tokensUsed);
  } catch (error) {
    console.error('[billing] recordTokenUsage error:', error);
  }
}
