import { sendLifecycleEmail } from '@/server/modules/lifecycle/email';

import { buildRecoveryEmail, type BuildRecoveryEmailInput } from './email-templates/recovery';

export interface SendRecoveryEmailInput extends BuildRecoveryEmailInput {
  to: string;
}

export interface SendRecoveryEmailResult {
  error?: string;
  messageId?: string;
  ok: boolean;
}

/**
 * Thin wrapper: build template → send via lifecycle helper. The
 * lifecycle helper is fail-safe (never throws), so this returns
 * its result unchanged.
 */
export async function sendRecoveryEmail(
  input: SendRecoveryEmailInput,
): Promise<SendRecoveryEmailResult> {
  const { to, ...templateInput } = input;
  const tpl = buildRecoveryEmail(templateInput);
  return sendLifecycleEmail({
    to,
    subject: tpl.subject,
    html: tpl.html,
    textBody: tpl.text,
  });
}
