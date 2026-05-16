import { eq } from 'drizzle-orm';

import { userBilling } from '@/database/schemas/billing';
import { type LobeChatDatabase } from '@/database/type';
import { BillingService } from '@/server/services/billing';

import { type ModelTier, type Usage } from './compute-cost';
import { calculateCreditsAsync } from './model-rates';
import { type PlanSlug } from './model-tiers';

/**
 * Per-tier daily caps are intentionally disabled. Users are constrained by
 * their monthly credit balance plus top-ups; spending it in 1–2 days should
 * lead to top-up, not a second artificial limiter.
 */
type TierCapMap = Partial<Record<ModelTier, number>>;

export const TIER_DAILY_CAPS: Record<PlanSlug, TierCapMap> = {
  basic: {},
  free: {},
  pro: {},
  pro_max: {},
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

    // No daily caps: monthly credits + top-ups are the only spend limiter.

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
    // Fail-closed: a transient PostgreSQL hiccup must NOT let a free user
    // bypass tier-gating and reach Sora 2 Pro at $0.50/sec ($25/request).
    // Better to refuse for ~30s than burn real money on premium models.
    console.error('[billing] checkUsageLimit error — failing closed for safety:', error);
    return {
      allowed: false,
      creditsRemaining: 0,
      message: 'Сервис временно недоступен. Попробуйте через минуту.',
    };
  }
}

/**
 * After a successful deduction, check if the user has run out of credits and
 * flag them for a zero_credits bot notification (at most once per UTC day).
 * Runs outside the billing transaction — a failure here must NOT affect billing.
 */
async function maybeFlagZeroCredits(db: LobeChatDatabase, userId: string): Promise<void> {
  try {
    const rows = await db
      .select({
        planId: userBilling.planId,
        tokenBalance: userBilling.tokenBalance,
        tokensUsedMonth: userBilling.tokensUsedMonth,
        tgBotChatId: userBilling.tgBotChatId,
        zeroCreditsNotifiedAt: userBilling.zeroCreditsNotifiedAt,
      })
      .from(userBilling)
      .where(eq(userBilling.userId, userId))
      .limit(1);

    const row = rows[0];
    if (!row || !row.tgBotChatId) return; // no bot registered — nothing to do

    const billingService = new BillingService(db, userId);
    const plan = await billingService.getPlanById(row.planId);
    const totalAvailable = (plan?.tokenLimit ?? 0) + row.tokenBalance;

    if (row.tokensUsedMonth < totalAvailable) return; // still has credits

    // Gate: one notification per UTC day maximum
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    if (row.zeroCreditsNotifiedAt && row.zeroCreditsNotifiedAt >= todayUtc) return;

    await db
      .update(userBilling)
      .set({
        zeroCreditsNotifiedAt: new Date(),
        botNotifyPending: true,
        botNotifyType: 'zero_credits',
      })
      .where(eq(userBilling.userId, userId));
  } catch (err) {
    // Non-fatal: notification missed is better than crashing a chat request
    console.error(`[billing] maybeFlagZeroCredits error for user=${userId}:`, err);
  }
}

export interface RecordTokenUsageExtras {
  cacheReadTokens?: number;
  cacheWrite1hTokens?: number;
  cacheWrite5mTokens?: number;
  kind?: 'chat' | 'image' | 'video';
  provider?: string;
  /**
   * Provider-reported cost in USD (e.g. OpenRouter `response.usage.cost`).
   * When present, computeCostUsdFromRate uses this × markup instead of
   * deriving cost from token counts × per-model rates.
   */
  providerCostUsd?: number;
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
      providerCostUsd: opts?.providerCostUsd,
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

    // Compute the cap so incrementTokensUsed can guard against TOCTOU.
    // checkUsageLimit ran at request start; concurrent streams from the
    // same user could each pass that check and then both bump
    // tokensUsedMonth past the cap. The conditional-UPDATE guard inside
    // incrementTokensUsed (`tokens_used_month + delta <= limit`) closes
    // that window — but only when we tell it the cap. Image-charge
    // already passes limit; chat-charge previously did not.
    const billing = await billingService.getOrCreateUserBilling();
    const plan = await billingService.getPlanById(billing.planId);
    const limit = (plan?.tokenLimit ?? 0) + (billing.tokenBalance ?? 0);

    // Atomic: increment monthly counter + insert usage_logs row. If either
    // fails, rollback — otherwise we end up with phantom credits (the counter
    // moves but no audit row exists). See writeUsageLog.ts for history.
    const { writeUsageLog } = await import('@/server/modules/analytics/writeUsageLog');
    await db.transaction(async (tx) => {
      await billingService.incrementTokensUsed(credits, tx, { limit });
      await writeUsageLog(tx, {
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
        providerCostUsd: opts?.providerCostUsd,
      });
    });

    console.info(
      `[billing] charged ${credits} credits: user=${userId} model=${modelId || 'unknown'} in=${tokensUsed} out=${outputTokens || 0} cw5m=${opts?.cacheWrite5mTokens ?? 0} cw1h=${opts?.cacheWrite1hTokens ?? 0} cr=${opts?.cacheReadTokens ?? 0}`,
    );

    // Post-transaction: flag user for zero_credits bot notification if applicable.
    // Fire-and-forget — must not block the response or interfere with billing tx.
    void maybeFlagZeroCredits(db, userId);
  } catch (error) {
    // Transaction rolled back → user NOT billed, no log row written. This is
    // correct behaviour (the alternative is phantom credits), but we need a
    // visible signal so we can diagnose the underlying insert failure
    // (numeric overflow on cost columns, unknown enum value, FK mismatch…).
    const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
    console.error(
      `[billing] charge transaction failed — rolled back. user=${userId} model=${modelId ?? 'unknown'}: ${msg}`,
    );
  }
}
