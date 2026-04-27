/**
 * Phase 2.3 — Email template builders for subscription lifecycle emails.
 *
 * Pure functions that produce { subject, html } pairs. No I/O. Tested.
 * Russian UX copy.
 */

const APP_URL = process.env.APP_URL || 'https://ask.gptweb.ru';
const PLANS_URL = `${APP_URL}/settings/plans`;

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
      <p>Чтобы не потерять доступ к Sonnet 4.6, Opus и DeepSeek Reasoner, продлите подписку:</p>
      <p>
        <a href="${PLANS_URL}" style="${CTA_STYLE}">Продлить подписку</a>
      </p>
      <p>Если у вас есть вопросы — просто ответьте на это письмо.</p>
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
  creditAmount: number;
  expiresAt: Date | string | null;
  planName: string;
}

export function buildSubscriptionConfirmationEmail(input: SubscriptionConfirmationInput): {
  subject: string;
  html: string;
  textBody: string;
} {
  const subject = 'Подписка WebGPT активирована — спасибо!';
  const dateStr = fmtDateRu(input.expiresAt);
  const html = `
    <div style="${BASE_STYLE}">
      <p>Здравствуйте!</p>
      <p>Подписка <strong>${escapeHtml(input.planName)}</strong> активна${dateStr ? ` до <strong>${dateStr}</strong>` : ''}.</p>
      <p>На баланс начислено <strong>${input.creditAmount.toLocaleString('ru-RU')}</strong> кредитов.</p>
      <p>Спасибо, что выбрали WebGPT! Если возникнут вопросы — просто ответьте на это письмо.</p>
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
    `Открыть WebGPT: ${APP_URL}`,
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
