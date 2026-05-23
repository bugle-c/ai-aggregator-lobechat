import { describe, expect, it } from 'vitest';

import { buildRecoveryEmail } from '../recovery';

const SAMPLE = {
  payment: {
    amountRub: 490,
    planName: 'Тариф Стандарт',
    type: 'subscription' as const,
  },
  recoveryUrl:
    'https://ask.gptweb.ru/api/billing/recovery-retry?payment=abc&method=any&t=eyJ...sig',
};

describe('buildRecoveryEmail', () => {
  it('renders Stage 1 for insufficient_funds with reason text + humour + CTA + URL', () => {
    const out = buildRecoveryEmail({
      ...SAMPLE,
      reasonCode: 'insufficient_funds',
      stage: 'stage1',
    });

    expect(out.subject).toContain('Карта стесняется');
    expect(out.subject.length).toBeLessThanOrEqual(60);
    expect(out.html).toContain('не хватило средств');
    expect(out.html).toContain('Бывает');
    expect(out.html).toContain('490');
    expect(out.html).toContain(SAMPLE.recoveryUrl);
    expect(out.text).toContain(SAMPLE.recoveryUrl);
  });

  it('renders Stage 2 with a different subject than Stage 1', () => {
    const s1 = buildRecoveryEmail({
      ...SAMPLE,
      reasonCode: 'insufficient_funds',
      stage: 'stage1',
    });
    const s2 = buildRecoveryEmail({
      ...SAMPLE,
      reasonCode: 'insufficient_funds',
      stage: 'stage2',
    });
    expect(s1.subject).not.toBe(s2.subject);
  });

  it('falls back to _default copy when reason is unknown', () => {
    const out = buildRecoveryEmail({
      ...SAMPLE,
      reasonCode: 'something_yk_invented_yesterday',
      stage: 'stage1',
    });
    expect(out.subject).toContain('Оплата не прошла');
    expect(out.html).toContain(SAMPLE.recoveryUrl);
  });

  it('handles topup type (no planName)', () => {
    const out = buildRecoveryEmail({
      payment: { amountRub: 99, type: 'topup' as const },
      recoveryUrl: SAMPLE.recoveryUrl,
      reasonCode: 'insufficient_funds',
      stage: 'stage1',
    });
    expect(out.html).toContain('99');
    expect(out.html).toContain(SAMPLE.recoveryUrl);
  });

  it('html-escapes the planName to prevent XSS', () => {
    const out = buildRecoveryEmail({
      payment: {
        amountRub: 100,
        planName: '<script>alert(1)</script>',
        type: 'subscription' as const,
      },
      recoveryUrl: SAMPLE.recoveryUrl,
      reasonCode: 'insufficient_funds',
      stage: 'stage1',
    });
    expect(out.html).not.toContain('<script>alert(1)</script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('preserves the recoveryUrl verbatim (no double-encoding)', () => {
    const tricky =
      'https://ask.gptweb.ru/api/billing/recovery-retry?payment=x&method=any&t=A.B-C_D';
    const out = buildRecoveryEmail({
      ...SAMPLE,
      reasonCode: 'insufficient_funds',
      stage: 'stage1',
      recoveryUrl: tricky,
    });
    expect(out.html).toContain(`href="${tricky}"`);
    expect(out.text).toContain(tricky);
  });
});
