/**
 * EXP-003: what the balance surfaces (header badge, sidebar plan card,
 * /settings/plans, usage page, low-balance hint) should say.
 *
 * The free plan's binding limit is N user messages per Moscow day, while
 * `creditLimit` (2500) is only a monthly safety cap — showing «2464 / 2500
 * кредитов» to a free user promises far more than the 5 messages they get.
 * One selector decides the variant so every surface agrees:
 *
 *   daily     — free plan, the daily gate applies → «5 сообщений в день»
 *   purchased — free plan, the gate is lifted by purchased credits (top-up
 *               or the MAGIC48 paid bonus) → «N кредитов · без дневного лимита»
 *   credits   — paid plans → monthly credit pool, unchanged
 *
 * `dailyGateBypassed` / `purchasedRemaining` come from `spend.getCreditState`,
 * which asks the server gate (`decideUsageLimit`) — the rule is not
 * re-implemented here.
 */
export interface BalanceSource {
  creditsUsed: number;
  dailyGateBypassed?: boolean;
  dailyQuota: number | null;
  dailyRemaining: number | null;
  dailyResetAt: string | null;
  purchasedRemaining?: number;
  totalAvailable: number;
}

export type BalanceView =
  | {
      kind: 'daily';
      quota: number;
      remaining: number;
      /** «00:00» — Moscow wall-clock time the quota refills at. */
      resetTime: string;
      /** Messages sent today, clamped to the quota for progress bars. */
      used: number;
    }
  | { kind: 'purchased'; remaining: number }
  | { kind: 'credits'; remaining: number; total: number };

/** Moscow wall-clock HH:mm of an ISO instant; the quota refills at 00:00 MSK. */
export const formatMskTime = (iso: string | null | undefined): string => {
  if (!iso) return '00:00';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '00:00';
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(date);
};

/**
 * Display-only mirror of the server's `FREE_DAILY_MESSAGE_QUOTA` for the
 * plan cards, where no free-plan credit state is in scope (paid users see
 * the cards too). Every live counter reads the quota from
 * `spend.getCreditState` instead.
 */
export const FREE_DAILY_MESSAGE_QUOTA_HINT = 5;

export type FreeQuotaView = Extract<BalanceView, { kind: 'daily' | 'purchased' }>;

export interface FreeQuota {
  bonusActive: number;
  bonusExpiresAt: string | null;
  view: FreeQuotaView;
}

export const selectBalanceView = (state: BalanceSource): BalanceView => {
  const { dailyQuota, dailyRemaining } = state;
  const isFree = dailyQuota != null && dailyRemaining != null;

  if (isFree && state.dailyGateBypassed) {
    return { kind: 'purchased', remaining: Math.max(0, state.purchasedRemaining ?? 0) };
  }

  if (isFree) {
    return {
      kind: 'daily',
      quota: dailyQuota,
      remaining: dailyRemaining,
      resetTime: formatMskTime(state.dailyResetAt),
      used: Math.min(dailyQuota, Math.max(0, dailyQuota - dailyRemaining)),
    };
  }

  return {
    kind: 'credits',
    remaining: Math.max(0, state.totalAvailable - state.creditsUsed),
    total: state.totalAvailable,
  };
};

/**
 * Free-plan part of `spend.getCreditState` for the settings pages, or null
 * on paid plans (where the monthly credit block stays as it was).
 */
export const freeQuotaOf = (
  state: BalanceSource & { bonusActive?: number; bonusExpiresAt?: string | null },
): FreeQuota | null => {
  const view = selectBalanceView(state);
  if (view.kind === 'credits') return null;
  return { bonusActive: state.bonusActive ?? 0, bonusExpiresAt: state.bonusExpiresAt ?? null, view };
};
