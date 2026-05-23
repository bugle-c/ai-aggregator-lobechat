import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sendLifecycleEmail } from '@/server/modules/lifecycle/email';

import { sendRecoveryEmail } from '../send-recovery-email';

vi.mock('@/server/modules/lifecycle/email', () => ({
  sendLifecycleEmail: vi.fn(),
}));

describe('sendRecoveryEmail', () => {
  beforeEach(() => {
    vi.mocked(sendLifecycleEmail).mockReset();
  });

  it('calls sendLifecycleEmail with subject/html/text from the template', async () => {
    vi.mocked(sendLifecycleEmail).mockResolvedValue({ ok: true, messageId: '<msgid@x>' });

    const out = await sendRecoveryEmail({
      to: 'user@example.com',
      payment: { amountRub: 490, type: 'subscription', planName: 'Тариф' },
      reasonCode: 'insufficient_funds',
      recoveryUrl: 'https://ask.gptweb.ru/api/billing/recovery-retry?x=1',
      stage: 'stage1',
    });

    expect(out).toEqual({ ok: true, messageId: '<msgid@x>' });
    expect(sendLifecycleEmail).toHaveBeenCalledOnce();
    const call = vi.mocked(sendLifecycleEmail).mock.calls[0][0];
    expect(call.to).toBe('user@example.com');
    expect(call.subject).toContain('Карта стесняется');
    expect(call.html).toContain('https://ask.gptweb.ru/api/billing/recovery-retry?x=1');
    expect(call.textBody).toContain('https://ask.gptweb.ru/api/billing/recovery-retry?x=1');
  });

  it('propagates errors as {ok:false, error}', async () => {
    vi.mocked(sendLifecycleEmail).mockResolvedValue({ ok: false, error: 'HTTP 500' });

    const out = await sendRecoveryEmail({
      to: 'user@example.com',
      payment: { amountRub: 490, type: 'subscription' },
      reasonCode: 'insufficient_funds',
      recoveryUrl: 'https://x',
      stage: 'stage1',
    });

    expect(out).toEqual({ ok: false, error: 'HTTP 500' });
  });
});
