/**
 * Phase 2.3 — Brevo transactional email helper for subscription lifecycle.
 *
 * Uses the Brevo REST API directly (no SDK) so we avoid pulling
 * `@getbrevo/brevo` into the runtime bundle. The pattern mirrors the
 * existing blog-automation `scripts/blog/notify.sh`.
 *
 * Configuration:
 *   BREVO_API_KEY      — required; if missing the helper logs and no-ops so
 *                        it never fails the calling code path.
 *   LIFECYCLE_EMAIL_FROM — sender address; defaults to noreply@pashavin.ru
 *                        (the verified sender for pashavin.ru).
 *   LIFECYCLE_EMAIL_FROM_NAME — sender display name; defaults to "WebGPT".
 *
 * All callers MUST wrap calls in try/catch — email is non-critical, never
 * fail the surrounding business operation (payment fulfill, etc.).
 */

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

export interface SendEmailParams {
  html: string;
  subject: string;
  /** Used as the bare-text fallback. Optional — Brevo will derive from html. */
  textBody?: string;
  to: string;
}

export interface SendEmailResult {
  error?: string;
  /** Brevo's messageId on success, undefined on failure. */
  messageId?: string;
  ok: boolean;
}

/**
 * Send a transactional email via Brevo. Always resolves (never throws),
 * returns { ok: false, error } on failure.
 */
export async function sendLifecycleEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn('[lifecycle/email] BREVO_API_KEY not set, skipping send to', params.to);
    return { ok: false, error: 'BREVO_API_KEY not configured' };
  }

  const senderEmail = process.env.LIFECYCLE_EMAIL_FROM || 'noreply@pashavin.ru';
  const senderName = process.env.LIFECYCLE_EMAIL_FROM_NAME || 'WebGPT';

  try {
    const res = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: [{ email: params.to }],
        subject: params.subject,
        htmlContent: params.html,
        ...(params.textBody ? { textContent: params.textBody } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(
        `[lifecycle/email] Brevo ${res.status} for ${params.to}: ${body.slice(0, 300)}`,
      );
      return { ok: false, error: `HTTP ${res.status}` };
    }

    const json = (await res.json().catch(() => ({}))) as { messageId?: string };
    return { ok: true, messageId: json.messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[lifecycle/email] send failed for', params.to, ':', msg);
    return { ok: false, error: msg };
  }
}
