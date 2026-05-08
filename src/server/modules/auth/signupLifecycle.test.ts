import { describe, expect, it } from 'vitest';

import { assessSignupEmail, isEmailDeliveryConfigured, shouldSendWelcomeEmail } from './signupLifecycle';

describe('signup lifecycle helpers', () => {
  it('detects disposable and suspicious signup emails without blocking normal domains', () => {
    expect(assessSignupEmail('client@gmail.com').suspicious).toBe(false);

    const disposable = assessSignupEmail('bot@mailinator.com');
    expect(disposable.suspicious).toBe(true);
    expect(disposable.reasons).toContain('disposable_domain');

    const typo = assessSignupEmail('lead@gmaij.com');
    expect(typo.suspicious).toBe(true);
    expect(typo.reasons).toContain('typo_domain');

    const plusAlias = assessSignupEmail('lead+123@example.com');
    expect(plusAlias.suspicious).toBe(true);
    expect(plusAlias.reasons).toContain('plus_alias');
  });

  it('only enables welcome email when flag and provider configuration are present', () => {
    expect(isEmailDeliveryConfigured({ EMAIL_SERVICE_PROVIDER: 'resend', RESEND_API_KEY: 'key', RESEND_FROM: 'WebGPT <noreply@gptweb.ru>' })).toBe(true);
    expect(isEmailDeliveryConfigured({ EMAIL_SERVICE_PROVIDER: 'nodemailer', SMTP_HOST: 'smtp.example.com', SMTP_PASS: 'pass', SMTP_USER: 'user' })).toBe(true);
    expect(isEmailDeliveryConfigured({ EMAIL_SERVICE_PROVIDER: 'resend', RESEND_API_KEY: 'key' })).toBe(false);

    expect(shouldSendWelcomeEmail({ EMAIL_WELCOME_ENABLED: true, EMAIL_SERVICE_PROVIDER: 'resend', RESEND_API_KEY: 'key', RESEND_FROM: 'noreply@gptweb.ru' })).toBe(true);
    expect(shouldSendWelcomeEmail({ EMAIL_WELCOME_ENABLED: false, EMAIL_SERVICE_PROVIDER: 'resend', RESEND_API_KEY: 'key', RESEND_FROM: 'noreply@gptweb.ru' })).toBe(false);
  });
});
