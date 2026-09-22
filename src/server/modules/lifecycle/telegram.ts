/**
 * Telegram DM for lifecycle notices, delivered through the bot's
 * `/internal/broadcast/send` endpoint (same auth as payment-recovery-notify:
 * `X-Internal-Token` = BOT_INTERNAL_TOKEN).
 *
 * Why not `botNotifyPending` + notify-bot-pending? That sweep only knows the
 * types the bot has formatters for (subscription_active / _expiring,
 * zero_credits, usage_warning); an unknown type gets a 400 and the row stays
 * pending forever. The broadcast endpoint takes free text, so no bot change
 * is needed. Text is MarkdownV2 — every reserved char MUST be escaped or
 * Telegram rejects the whole message.
 *
 * Never throws — returns `{ ok: false, error }` so the caller decides
 * whether to retry on the next cron tick.
 */
const PLANS_URL = `${process.env.APP_URL || 'https://ask.gptweb.ru'}/settings/plans`;

const MDV2_RESERVED = /[_*[\]()~`>#+\-=|{}.!\\]/g;

export function escapeMarkdownV2(s: string): string {
  return s.replaceAll(MDV2_RESERVED, (c) => `\\${c}`);
}

export interface SendTelegramNoticeResult {
  error?: string;
  ok: boolean;
  /**
   * The chat is unreachable for good (`blocked` — user blocked the bot,
   * `deactivated` — account gone). Retrying is pointless; treat as
   * "no channel".
   */
  permanent?: boolean;
}

const PERMANENT_ERRORS = new Set(['blocked', 'deactivated']);

/** Shared transport for every lifecycle DM. Never throws. */
async function sendBroadcast(args: {
  button: { label: string; url: string };
  chatId: number;
  text: string;
}): Promise<SendTelegramNoticeResult> {
  const url = process.env.BOT_INTERNAL_URL ?? 'http://127.0.0.1:8082';
  const token = process.env.BOT_INTERNAL_TOKEN;
  if (!token) return { ok: false, error: 'no_internal_token' };

  try {
    const res = await fetch(`${url}/internal/broadcast/send`, {
      body: JSON.stringify({
        button: args.button,
        chat_id: args.chatId,
        text: args.text,
      }),
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token },
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
    if (res.ok && json.ok) return { ok: true };
    const error = json.error ?? `HTTP ${res.status}`;
    return { ok: false, error, permanent: PERMANENT_ERRORS.has(error) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * Off-session renewal charge declined. Deliberately NOT the checkout-recovery
 * invoice («вы не закончили оплату») — the user started nothing; their saved
 * card was refused.
 */
export async function sendRenewalFailedTelegram(args: {
  amountRub: number;
  chatId: number;
  planName: string;
}): Promise<SendTelegramNoticeResult> {
  const text = escapeMarkdownV2(
    `Не удалось продлить подписку «${args.planName}» — обновите карту. Банк отклонил списание ${args.amountRub} ₽. Привяжите другую карту, и мы повторим списание автоматически.`,
  );
  return sendBroadcast({
    button: { label: 'Обновить карту', url: PLANS_URL },
    chatId: args.chatId,
    text,
  });
}

/**
 * Pre-charge notice, T-3, for an auto-renewing subscriber we cannot email
 * (TG-native sign-up → synthetic address, or Brevo refused the send).
 *
 * ФЗ 376 requires this notice at least 3 days before the charge, naming the
 * sum, the date and the way to refuse — a channel the user does not have is
 * not an excuse to charge them silently. The renew cron refuses to charge
 * anyone with no channel at all (see hasPreChargeChannel).
 */
export async function sendUpcomingChargeTelegram(args: {
  amountRub: number;
  chargeAt: Date;
  chatId: number;
  planName: string;
}): Promise<SendTelegramNoticeResult> {
  const dateStr = args.chargeAt.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  });
  const text = escapeMarkdownV2(
    `Подписка «${args.planName}» продлевается автоматически: ${dateStr} спишем ${args.amountRub} ₽ с привязанной карты. Если продление больше не нужно — отмените его в настройках, доступ сохранится до конца оплаченного периода.`,
  );
  return sendBroadcast({
    button: { label: 'Настройки подписки', url: PLANS_URL },
    chatId: args.chatId,
    text,
  });
}

/**
 * Written confirmation of a refusal for users we cannot email. Says the two
 * things ст. 16.1 ЗПП wants in writing: no further charges, and the card
 * details are gone.
 */
export async function sendCancellationConfirmedTelegram(args: {
  activeUntil: Date | null;
  chatId: number;
  planName: string;
}): Promise<SendTelegramNoticeResult> {
  const dateStr = args.activeUntil
    ? args.activeUntil.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    : null;
  const text = escapeMarkdownV2(
    `Автоматическое продление отключено — списаний больше не будет. Сохранённая карта удалена. ` +
      (dateStr
        ? `Доступ к тарифу «${args.planName}» сохраняется до ${dateStr}, после этой даты аккаунт перейдёт на бесплатный тариф.`
        : `Аккаунт переведён на бесплатный тариф.`),
  );
  return sendBroadcast({
    button: { label: 'Настройки подписки', url: PLANS_URL },
    chatId: args.chatId,
    text,
  });
}

export async function sendSubscriptionExpiredTelegram(args: {
  chatId: number;
  expiredAt: Date;
  planName: string;
}): Promise<SendTelegramNoticeResult> {
  const dateStr = args.expiredAt.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  });
  const text = escapeMarkdownV2(
    `Тариф «${args.planName}» закончился ${dateStr}. Аккаунт переведён на бесплатный тариф — продлите подписку, и доступ к моделям вернётся сразу после оплаты.`,
  );
  return sendBroadcast({
    button: { label: 'Продлить подписку', url: PLANS_URL },
    chatId: args.chatId,
    text,
  });
}
