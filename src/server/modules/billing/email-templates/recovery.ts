import { resolveCopy } from './recovery-copy';

export interface BuildRecoveryEmailInput {
  payment: {
    amountRub: number;
    /** Optional — only present for subscription type. */
    planName?: string;
    type: 'subscription' | 'topup';
  };
  reasonCode: string | null | undefined;
  recoveryUrl: string;
  stage: 'stage1' | 'stage2';
}

export interface BuildRecoveryEmailOutput {
  html: string;
  subject: string;
  text: string;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function applyAmount(template: string, amount: number): string {
  return template.replaceAll('{{amount}}', String(amount));
}

/**
 * Pure email body builder. No I/O. Selects copy by (reasonCode, stage),
 * substitutes amount/url, escapes user-controlled fields, returns
 * subject + html + text.
 */
export function buildRecoveryEmail(input: BuildRecoveryEmailInput): BuildRecoveryEmailOutput {
  const copy = resolveCopy(input.reasonCode, input.stage);
  const subject = copy.subject;
  const ctaLabel = applyAmount(copy.ctaLabel, input.payment.amountRub);
  const planLine = input.payment.planName
    ? `<p style="margin:8px 0 0;color:#666;font-size:14px;">${escapeHtml(input.payment.planName)}</p>`
    : '';

  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#222;line-height:1.5;">
<h2 style="margin-top:0;">${escapeHtml(copy.subject)}</h2>
<p>${escapeHtml(copy.reasonHook)}</p>
<p>${escapeHtml(copy.humorLine)}</p>
${planLine}
<p style="margin:32px 0;">
  <a href="${input.recoveryUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;">${escapeHtml(ctaLabel)}</a>
</p>
<p style="color:#666;font-size:14px;">Ссылка персональная, действует 7 дней. Если оплата уже не нужна — просто проигнорируйте письмо.</p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
<p style="color:#888;font-size:13px;">— Команда WebGPT · <a href="https://ask.gptweb.ru" style="color:#888;">ask.gptweb.ru</a></p>
</body></html>`;

  const text = [
    copy.subject,
    '',
    copy.reasonHook,
    copy.humorLine,
    input.payment.planName ? input.payment.planName : '',
    '',
    `${ctaLabel}:`,
    input.recoveryUrl,
    '',
    'Ссылка персональная, действует 7 дней.',
    '',
    '— Команда WebGPT',
    'https://ask.gptweb.ru',
  ]
    .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
    .join('\n');

  return { subject, html, text };
}
