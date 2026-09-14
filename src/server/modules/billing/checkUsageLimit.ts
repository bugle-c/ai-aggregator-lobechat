import { eq } from 'drizzle-orm';

import { userBilling } from '@/database/schemas/billing';
import { type LobeChatDatabase } from '@/database/type';
import { BillingService } from '@/server/services/billing';

import { activeBonusFor } from './active-bonus';
import { type ModelTier, type Usage } from './compute-cost';
import {
  countUserMessagesSince,
  FREE_DAILY_MESSAGE_QUOTA,
  FREE_PLAN_SLUG,
  moscowDayStart,
} from './daily-quota';
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

/**
 * Why a request was refused. Travels to the client in the chat route error
 * body (`code: 'credits_exhausted'`, `reason`) so the paywall picks its copy:
 *   daily_quota — free plan, today's message allowance is spent (refills 00:00 MSK)
 *   monthly_cap — free plan, the monthly safety cap (`plans.token_limit`) is hit
 *   credits     — paid plan, or top-up/bonus credits that are now all spent
 */
export type UsageLimitReason = 'credits' | 'daily_quota' | 'monthly_cap';

export type UsageKind = 'chat' | 'image' | 'video';

export interface UsageLimitResult {
  allowed: boolean;
  creditsRemaining?: number;
  /** Free-plan daily quota size — set only when the quota applied to this request. */
  dailyQuota?: number;
  /** Free-plan messages left today — set only when the quota applied to this request. */
  dailyRemaining?: number;
  message?: string;
  reason?: UsageLimitReason;
}

export const USAGE_LIMIT_MESSAGES: Record<UsageLimitReason, string> = {
  credits: 'Кредиты закончились. Пополните баланс или обновите план.',
  daily_quota: `Лимит на сегодня исчерпан. ${FREE_DAILY_MESSAGE_QUOTA} бесплатных сообщений в день закончились — новые появятся завтра в 00:00 по Москве.`,
  monthly_cap:
    'Кредиты закончились. Месячный лимит бесплатного тарифа исчерпан — обновите план или пополните баланс.',
};

export interface UsageLimitInput {
  /** Active (non-expired) bonus pool — MAGIC48 intro, TG-link +100, referral +100. */
  bonus: number;
  /**
   * `false` for system/preset completions (topic auto-title, agent meta —
   * `x-webgpt-task: preset`): they are neither counted nor blocked by the
   * daily quota. Default `true`.
   */
  countsTowardQuota?: boolean;
  /** Monthly allowance of the plan (`plans.token_limit`). */
  creditLimit: number;
  /**
   * User messages persisted today (00:00 MSK), INCLUDING the one being
   * answered — the client and the bot persist the user message before the
   * streaming route runs the gate. Only consulted for free-plan chat.
   */
  dailyUsed?: number;
  kind: UsageKind;
  planSlug: string | undefined;
  /** Top-up purchases (`user_billing.token_balance`). */
  tokenBalance: number;
  tokensUsedMonth: number;
}

/**
 * Pure gate decision. Precedence (EXP-003):
 *
 * 1. Monthly pool `token_limit + token_balance + bonus` is exhausted → refuse.
 *    Free users with no paid pools get `monthly_cap`, everybody else `credits`.
 * 2. Free plan + chat (unless `countsTowardQuota=false`): the **daily quota**.
 *    `dailyUsed` already includes the current message, so the 5th message
 *    (dailyUsed=5) passes and the 6th (dailyUsed=6) is refused.
 *    **Only purchased credits lift the quota** (owner decision, review
 *    2026-09-13): bonus pools (TG-link, referral, MAGIC48) reach most
 *    activated users and would have switched the experiment off for them —
 *    `bonus_balance` only extends the monthly pool. The bypass budget is the
 *    purchase ALONE: it holds while `tokensUsedMonth < token_balance`. The
 *    free monthly allowance (`token_limit`, 2500 — sized as a safety cap,
 *    not as spendable-without-limit) is NOT part of the budget, and free
 *    usage made before the purchase simply eats into it (hotfix 2026-09-14:
 *    `token_balance − max(0, used − creditLimit)` let a 99 ₽ top-up unlock
 *    allowance + top-up ≈ 2 900 credits with no daily gate). Once the
 *    counter passes the purchase, 5/day applies again while the monthly
 *    pool (allowance + top-up + bonus) still governs monthly_cap/credits.
 *    Bonus expiry only shrinks the monthly pool; it never changes the daily
 *    decision.
 * 3. Paid plans and image/video generation never see the daily quota.
 */
export function decideUsageLimit(input: UsageLimitInput): UsageLimitResult {
  const { bonus, creditLimit, dailyUsed, kind, planSlug, tokenBalance, tokensUsedMonth } = input;
  const countsTowardQuota = input.countsTowardQuota ?? true;
  const extraCredits = tokenBalance + bonus;
  const totalAvailable = creditLimit + extraCredits;
  const isFree = planSlug === FREE_PLAN_SLUG;

  if (tokensUsedMonth >= totalAvailable) {
    const reason: UsageLimitReason = isFree && extraCredits <= 0 ? 'monthly_cap' : 'credits';
    return { allowed: false, creditsRemaining: 0, message: USAGE_LIMIT_MESSAGES[reason], reason };
  }

  const creditsRemaining = totalAvailable - tokensUsedMonth;
  if (!isFree || kind !== 'chat' || !countsTowardQuota) return { allowed: true, creditsRemaining };

  const used = dailyUsed ?? 0;
  const dailyRemaining = Math.max(0, FREE_DAILY_MESSAGE_QUOTA - used);
  const purchasedRemaining = tokenBalance > 0 ? tokenBalance - tokensUsedMonth : 0;
  if (used > FREE_DAILY_MESSAGE_QUOTA && purchasedRemaining <= 0) {
    return {
      allowed: false,
      creditsRemaining,
      dailyQuota: FREE_DAILY_MESSAGE_QUOTA,
      dailyRemaining: 0,
      message: USAGE_LIMIT_MESSAGES.daily_quota,
      reason: 'daily_quota',
    };
  }

  return { allowed: true, creditsRemaining, dailyQuota: FREE_DAILY_MESSAGE_QUOTA, dailyRemaining };
}

export async function checkUsageLimit(
  db: LobeChatDatabase,
  userId: string,
  modelId?: string,
  opts: { countsTowardQuota?: boolean; kind?: UsageKind } = {},
): Promise<UsageLimitResult> {
  try {
    const kind = opts.kind ?? 'chat';
    const countsTowardQuota = opts.countsTowardQuota ?? true;
    const billingService = new BillingService(db, userId);
    const billing = await billingService.getOrResetUserBilling();
    const plan = await billingService.getPlanById(billing.planId);
    const creditLimit = plan?.tokenLimit || 50;

    // The daily count is only needed for free-plan user chat — one indexed
    // count(*) over messages (role='user') since 00:00 MSK.
    const dailyUsed =
      plan?.slug === FREE_PLAN_SLUG && kind === 'chat' && countsTowardQuota
        ? await countUserMessagesSince(db, userId, moscowDayStart())
        : undefined;

    return decideUsageLimit({
      bonus: activeBonusFor(billing),
      countsTowardQuota,
      creditLimit,
      dailyUsed,
      kind,
      planSlug: plan?.slug,
      tokenBalance: billing.tokenBalance,
      tokensUsedMonth: billing.tokensUsedMonth,
    });
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
        bonusBalance: userBilling.bonusBalance,
        bonusBalanceExpiresAt: userBilling.bonusBalanceExpiresAt,
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
    const totalAvailable = (plan?.tokenLimit ?? 0) + row.tokenBalance + activeBonusFor(row);

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
    const limit = (plan?.tokenLimit ?? 0) + (billing.tokenBalance ?? 0) + activeBonusFor(billing);

    // Clamp the charge to the credits actually left. Chat billing is
    // post-completion — the answer already streamed. If the true cost would
    // overshoot the cap, incrementTokensUsed's conditional guard THROWS and
    // the whole charge (counter + usage_log) rolls back: the user gets the
    // message free AND the counter never reaches the cap, so the next
    // request's start-gate (`tokensUsedMonth >= totalAvailable`) never fires
    // → free chat forever at the boundary. Charging exactly what remains
    // drives the counter to the cap so the next message is blocked. The
    // boundary message costs at most its remaining credits — acceptable.
    const remainingCredits = Math.max(0, limit - (billing.tokensUsedMonth ?? 0));
    const chargedCredits = Math.min(credits, remainingCredits);
    if (chargedCredits <= 0) return; // already at cap — start-gate blocks next request

    // Atomic: increment monthly counter + insert usage_logs row. If either
    // fails, rollback — otherwise we end up with phantom credits (the counter
    // moves but no audit row exists). See writeUsageLog.ts for history.
    const { writeUsageLog } = await import('@/server/modules/analytics/writeUsageLog');
    await db.transaction(async (tx) => {
      await billingService.incrementTokensUsed(chargedCredits, tx, { limit });
      await writeUsageLog(tx, {
        userId,
        model: modelId || 'unknown',
        provider: opts?.provider || 'unknown',
        inputTokens: tokensUsed,
        outputTokens: outputTokens ?? 0,
        cacheWrite5mTokens: opts?.cacheWrite5mTokens ?? 0,
        cacheWrite1hTokens: opts?.cacheWrite1hTokens ?? 0,
        cacheReadTokens: opts?.cacheReadTokens ?? 0,
        creditsCharged: chargedCredits,
        kind: opts?.kind || 'chat',
        providerCostUsd: opts?.providerCostUsd,
      });
    });

    console.info(
      `[billing] charged ${chargedCredits} credits: user=${userId} model=${modelId || 'unknown'} in=${tokensUsed} out=${outputTokens || 0} cw5m=${opts?.cacheWrite5mTokens ?? 0} cw1h=${opts?.cacheWrite1hTokens ?? 0} cr=${opts?.cacheReadTokens ?? 0}`,
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
