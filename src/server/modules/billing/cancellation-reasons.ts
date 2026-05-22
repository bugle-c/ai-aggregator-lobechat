/**
 * YooKassa payment cancellation/failure reason → human-readable RU text
 * + which recovery method to suggest.
 *
 * Single source of truth used by:
 *   - the in-app RetryModal (src/features/PaymentRetry)
 *   - the Telegram recovery DM (bot endpoint)
 *   - the admin observability page (webgpt-admin)
 *
 * `suggest` values:
 *   - 'sbp'         — recommend SBP (faster payments via bank app, no 3DS)
 *   - 'retry_same'  — same method, just try again (transient issue)
 *   - 'retry'       — generic retry (probably timeout / closed window)
 *   - 'support'     — point user at @gptwebrubot for manual help
 */
export type Suggest = 'sbp' | 'retry_same' | 'retry' | 'support';

export interface ReasonDescription {
  readonly suggest: Suggest;
  readonly text: string;
}

export const REASON_MAP: Record<string, ReasonDescription> = {
  '3d_secure_failed': { text: 'Не прошла проверка 3-D Secure', suggest: 'sbp' },
  'canceled_by_merchant': { text: 'Отменено системой', suggest: 'retry' },
  'card_expired': { text: 'Срок действия карты истёк', suggest: 'sbp' },
  'country_forbidden': { text: 'Карта из неподдерживаемой страны', suggest: 'sbp' },
  'expired_on_capture': { text: 'Сорвался захват средств', suggest: 'retry' },
  'expired_on_confirmation': { text: 'Не успели подтвердить за час', suggest: 'retry' },
  'fraud_suspected': { text: 'Подозрение на фрод', suggest: 'support' },
  'general_decline': { text: 'Банк отклонил без объяснений', suggest: 'sbp' },
  'insufficient_funds': { text: 'На карте не хватило средств', suggest: 'retry_same' },
  'internal_timeout': { text: 'Технический сбой YooKassa', suggest: 'retry' },
  'payment_method_restricted': { text: 'Банк не разрешает онлайн-оплаты', suggest: 'sbp' },
  'permission_revoked': { text: 'Отозваны права на оплату', suggest: 'sbp' },
};

const FALLBACK: ReasonDescription = { text: 'Платёж не прошёл', suggest: 'sbp' };

export function describeReason(reason: string | null | undefined): ReasonDescription {
  if (!reason) return FALLBACK;
  return REASON_MAP[reason] ?? FALLBACK;
}
