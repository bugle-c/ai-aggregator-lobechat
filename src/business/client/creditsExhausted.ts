import { type ChatMessageError } from '@lobechat/types';

/**
 * Marker the chat route attaches to the credits-exhausted refusal
 * (`webapi/chat/[provider]/route.ts`, checkUsageLimit). The refusal is a
 * generic InternalServerError type, so the client tells it apart by this
 * body code; the message text is the fallback for rows persisted before
 * the code existed.
 */
export const CREDITS_EXHAUSTED_CODE = 'credits_exhausted';

const CREDITS_EXHAUSTED_TEXTS = ['Кредиты закончились', 'Лимит на сегодня исчерпан'];

/**
 * Mirrors `UsageLimitReason` on the server (checkUsageLimit.ts):
 *   daily_quota — free plan, today's message allowance is spent (EXP-003)
 *   monthly_cap — free plan, monthly safety cap hit
 *   credits     — paid plan / top-up + bonus pools all spent
 */
export type CreditsExhaustedReason = 'credits' | 'daily_quota' | 'monthly_cap';

interface ExhaustedErrorBody {
  code?: unknown;
  dailyQuota?: unknown;
  error?: { message?: unknown };
  errorMessage?: unknown;
  reason?: unknown;
}

const bodyOf = (error: ChatMessageError): ExhaustedErrorBody =>
  (error.body ?? {}) as ExhaustedErrorBody;

export const isCreditsExhaustedChatError = (
  error: ChatMessageError | null | undefined,
): boolean => {
  if (!error) return false;
  const body = bodyOf(error);
  if (body.code === CREDITS_EXHAUSTED_CODE) return true;
  const text = [body.errorMessage, body.error?.message, error.message]
    .filter((v): v is string => typeof v === 'string')
    .join('\n');
  return CREDITS_EXHAUSTED_TEXTS.some((marker) => text.includes(marker));
};

/** Why the request was refused; `credits` when the body carries no reason (pre-EXP-003 rows). */
export const getCreditsExhaustedReason = (
  error: ChatMessageError | null | undefined,
): CreditsExhaustedReason => {
  const reason = error ? bodyOf(error).reason : undefined;
  return reason === 'daily_quota' || reason === 'monthly_cap' ? reason : 'credits';
};

/** Daily quota size the server refused with (free plan), if present in the body. */
export const getCreditsExhaustedDailyQuota = (
  error: ChatMessageError | null | undefined,
): number | undefined => {
  const quota = error ? bodyOf(error).dailyQuota : undefined;
  return typeof quota === 'number' ? quota : undefined;
};
