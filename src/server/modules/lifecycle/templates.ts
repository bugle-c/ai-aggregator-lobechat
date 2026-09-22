/**
 * Phase 2.3 — Email template builders for subscription lifecycle emails.
 *
 * Pure functions that produce { subject, html } pairs. No I/O. Tested.
 * Russian UX copy.
 */

const APP_URL = process.env.APP_URL || 'https://ask.gptweb.ru';
const PLANS_URL = `${APP_URL}/settings/plans`;
const SUPPORT_URL = 'https://t.me/gptwebrubot?start=support';

const BASE_STYLE = `
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 15px; line-height: 1.55; color: #222;
`;
const CTA_STYLE = `
  display: inline-block; background: #1677ff; color: #fff !important;
  text-decoration: none; padding: 12px 24px; border-radius: 6px;
  font-weight: 500; margin: 16px 0;
`;
const FOOTER_STYLE = `
  font-size: 12px; color: #999; margin-top: 32px;
  border-top: 1px solid #eee; padding-top: 16px;
`;

function fmtDateRu(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export interface ExpiryReminderInput {
  expiresAt: Date | string;
  planName: string;
}

export function buildExpiryReminderEmail(input: ExpiryReminderInput): {
  subject: string;
  html: string;
  textBody: string;
} {
  const subject = 'Ваша подписка WebGPT истекает через 3 дня';
  const dateStr = fmtDateRu(input.expiresAt);
  const html = `
    <div style="${BASE_STYLE}">
      <p>Здравствуйте!</p>
      <p>Ваша подписка <strong>${escapeHtml(input.planName)}</strong> на WebGPT истекает
      ${dateStr ? `<strong>${dateStr}</strong>` : 'через 3 дня'}.</p>
      <p>Чтобы не потерять доступ к топовым моделям вашего тарифа, продлите подписку:</p>
      <p>
        <a href="${PLANS_URL}" style="${CTA_STYLE}">Продлить подписку</a>
      </p>
      <p>Если у вас есть вопросы — напишите в поддержку в Telegram: <a href="${SUPPORT_URL}">@gptwebrubot</a>.</p>
      <div style="${FOOTER_STYLE}">
        WebGPT · ask.gptweb.ru<br />
        Это автоматическое уведомление, отправленное за 3 дня до истечения вашей подписки.
      </div>
    </div>
  `;
  const textBody = [
    `Ваша подписка ${input.planName} на WebGPT истекает ${dateStr || 'через 3 дня'}.`,
    `Продлить подписку: ${PLANS_URL}`,
  ].join('\n\n');
  return { subject, html, textBody };
}

export interface SubscriptionConfirmationInput {
  /**
   * The card was saved and the renew cron will charge it at `expiresAt`.
   * False for one-shot purchases (YOOKASSA_RECURRING_ENABLED off, or the
   * shop lacks recurring permission) — then no charge notice is shown.
   */
  autoRenew?: boolean;
  creditAmount: number;
  expiresAt: Date | string | null;
  planName: string;
  /** Amount the next auto-charge will take, in rubles. */
  priceRub?: number;
}

export function buildSubscriptionConfirmationEmail(input: SubscriptionConfirmationInput): {
  subject: string;
  html: string;
  textBody: string;
} {
  const subject = 'Подписка WebGPT активирована — спасибо!';
  const dateStr = fmtDateRu(input.expiresAt);
  // Recurring disclosure with the concrete next-charge date. Legally this is
  // the receipt that tells the payer their card is on file — omit it only
  // when there is genuinely no saved method to charge.
  const showRenewal = !!input.autoRenew && !!input.priceRub && input.priceRub > 0 && !!dateStr;
  const renewalLine = showRenewal
    ? `Продлевается автоматически ${dateStr} по ${input.priceRub} ₽/мес, отменить можно в любой момент.`
    : '';
  const html = `
    <div style="${BASE_STYLE}">
      <p>Здравствуйте!</p>
      <p>Подписка <strong>${escapeHtml(input.planName)}</strong> активна${dateStr ? ` до <strong>${dateStr}</strong>` : ''}.</p>
      <p>На баланс начислено <strong>${input.creditAmount.toLocaleString('ru-RU')}</strong> кредитов.</p>
      ${renewalLine ? `<p>${escapeHtml(renewalLine)}</p>` : ''}
      <p>Спасибо, что выбрали WebGPT! Если возникнут вопросы — напишите в поддержку в Telegram: <a href="${SUPPORT_URL}">@gptwebrubot</a>.</p>
      <p>
        <a href="${APP_URL}" style="${CTA_STYLE}">Открыть WebGPT</a>
      </p>
      <div style="${FOOTER_STYLE}">
        WebGPT · ask.gptweb.ru
      </div>
    </div>
  `;
  const textBody = [
    `Подписка ${input.planName} активирована${dateStr ? ` до ${dateStr}` : ''}.`,
    `На баланс начислено ${input.creditAmount} кредитов.`,
    ...(renewalLine ? [renewalLine] : []),
    `Открыть WebGPT: ${APP_URL}`,
  ].join('\n\n');
  return { subject, html, textBody };
}

export interface UpcomingChargeInput {
  /** Amount the card will actually be charged, in rubles. */
  amountRub: number;
  chargeAt: Date | string;
  planName: string;
}

/**
 * Pre-charge notice for auto-renewing subscribers. Replaces the «истекает,
 * продлите» reminder, which is factually wrong for anyone whose card is on
 * file — nothing expires, we take money.
 */
export function buildUpcomingChargeEmail(input: UpcomingChargeInput): {
  subject: string;
  html: string;
  textBody: string;
} {
  const dateStr = fmtDateRu(input.chargeAt);
  const subject = 'Скоро продлим вашу подписку WebGPT';
  const notice = `${dateStr} спишем ${input.amountRub} ₽ — отменить можно в настройках.`;
  const html = `
    <div style="${BASE_STYLE}">
      <p>Здравствуйте!</p>
      <p>Подписка <strong>${escapeHtml(input.planName)}</strong> на WebGPT продлевается автоматически.</p>
      <p><strong>${escapeHtml(notice)}</strong></p>
      <p>Если продление больше не нужно — отключите его в настройках, доступ сохранится до конца оплаченного периода:</p>
      <p>
        <a href="${PLANS_URL}" style="${CTA_STYLE}">Настройки подписки</a>
      </p>
      <p>Если у вас есть вопросы — напишите в поддержку в Telegram: <a href="${SUPPORT_URL}">@gptwebrubot</a>.</p>
      <div style="${FOOTER_STYLE}">
        WebGPT · ask.gptweb.ru<br />
        Это автоматическое уведомление о предстоящем списании по вашей подписке.
      </div>
    </div>
  `;
  const textBody = [
    `Подписка ${input.planName} на WebGPT продлевается автоматически.`,
    notice,
    `Настройки подписки: ${PLANS_URL}`,
  ].join('\n\n');
  return { subject, html, textBody };
}

export interface RenewalFailedInput {
  amountRub: number;
  planName: string;
}

/**
 * Off-session renewal charge was declined. This is NOT the checkout-recovery
 * flow: the user never started a payment, so «вы не закончили оплату» would
 * be a lie. Ask them to update the card instead.
 */
export function buildRenewalFailedEmail(input: RenewalFailedInput): {
  subject: string;
  html: string;
  textBody: string;
} {
  const subject = 'Не удалось продлить подписку WebGPT — обновите карту';
  const html = `
    <div style="${BASE_STYLE}">
      <p>Здравствуйте!</p>
      <p>Не удалось продлить подписку <strong>${escapeHtml(input.planName)}</strong> — обновите карту.
      Банк отклонил списание ${input.amountRub} ₽ с привязанной карты (недостаточно средств,
      истёк срок действия или карта заблокирована).</p>
      <p>Привяжите другую карту — мы повторим списание автоматически, и доступ восстановится:</p>
      <p>
        <a href="${PLANS_URL}" style="${CTA_STYLE}">Обновить карту</a>
      </p>
      <p>Если у вас есть вопросы — напишите в поддержку в Telegram: <a href="${SUPPORT_URL}">@gptwebrubot</a>.</p>
      <div style="${FOOTER_STYLE}">
        WebGPT · ask.gptweb.ru<br />
        Это автоматическое уведомление о неудачном автопродлении подписки.
      </div>
    </div>
  `;
  const textBody = [
    `Не удалось продлить подписку ${input.planName} — обновите карту.`,
    `Банк отклонил списание ${input.amountRub} ₽ с привязанной карты.`,
    `Обновить карту: ${PLANS_URL}`,
  ].join('\n\n');
  return { subject, html, textBody };
}

export interface SubscriptionExpiredInput {
  expiredAt: Date | string;
  planName: string;
}

export function buildSubscriptionExpiredEmail(input: SubscriptionExpiredInput): {
  subject: string;
  html: string;
  textBody: string;
} {
  const subject = `Тариф «${input.planName}» закончился — продлить?`;
  const dateStr = fmtDateRu(input.expiredAt);
  const html = `
    <div style="${BASE_STYLE}">
      <p>Здравствуйте!</p>
      <p>Тариф <strong>${escapeHtml(input.planName)}</strong> на WebGPT закончился${dateStr ? ` <strong>${dateStr}</strong>` : ''}.
      Аккаунт переведён на бесплатный тариф: ваши чаты и настройки на месте, но
      топовые модели вашего тарифа снова закрыты.</p>
      <p>Продлите подписку — доступ вернётся сразу после оплаты:</p>
      <p>
        <a href="${PLANS_URL}" style="${CTA_STYLE}">Продлить подписку</a>
      </p>
      <p>Если у вас есть вопросы — напишите в поддержку в Telegram: <a href="${SUPPORT_URL}">@gptwebrubot</a>.</p>
      <div style="${FOOTER_STYLE}">
        WebGPT · ask.gptweb.ru<br />
        Это автоматическое уведомление об окончании вашей подписки.
      </div>
    </div>
  `;
  const textBody = [
    `Тариф ${input.planName} на WebGPT закончился${dateStr ? ` ${dateStr}` : ''}. Аккаунт переведён на бесплатный тариф.`,
    `Продлить подписку: ${PLANS_URL}`,
  ].join('\n\n');
  return { subject, html, textBody };
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
