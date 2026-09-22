import { describe, expect, it } from 'vitest';

import {
  buildCardRemovalPatch,
  buildSubscriptionRefusalPatch,
  canAutoChargeStoredMethod,
  type ChargeGateRow,
} from '../recurringRefusal';

const chargeable = (over: Partial<ChargeGateRow> = {}): ChargeGateRow => ({
  autoRenew: true,
  cancelledAt: null,
  email: 'real@example.com',
  paymentMethodId: 'pm_live_123',
  tgBotChatId: null,
  ...over,
});

describe('buildSubscriptionRefusalPatch', () => {
  // ФЗ 376 / ст. 16.1 ЗПП: the law forbids USING the payment details after a
  // refusal, not merely "running the renewal job".
  it('DELETES the stored card token, not just auto_renew', () => {
    const patch = buildSubscriptionRefusalPatch({ reasonCode: 'too_expensive' });

    expect(patch.paymentMethodId).toBeNull();
    expect(patch.autoRenew).toBe(false);
  });

  it('stamps the refusal moment and reason', () => {
    const now = new Date('2026-10-01T09:30:00Z');
    const patch = buildSubscriptionRefusalPatch({ now, reasonCode: 'not_using' });

    expect(patch.cancelledAt).toEqual(now);
    expect(patch.cancelReasonCode).toBe('not_using');
  });

  it('never touches subscription_expires_at — a refusal is not a forfeit', () => {
    const patch = buildSubscriptionRefusalPatch({ reasonCode: 'other' });

    expect(patch).not.toHaveProperty('subscriptionExpiresAt');
    expect(patch).not.toHaveProperty('planId');
  });
});

describe('buildCardRemovalPatch', () => {
  it('clears the token and auto-renewal without marking a cancellation', () => {
    const patch = buildCardRemovalPatch();

    expect(patch).toEqual({ autoRenew: false, paymentMethodId: null });
    expect(patch).not.toHaveProperty('cancelledAt');
  });
});

describe('canAutoChargeStoredMethod', () => {
  it('allows the charge for a live auto-renewing subscriber with an email', () => {
    expect(canAutoChargeStoredMethod(chargeable())).toBe(true);
  });

  it('allows it for a TG-native subscriber reachable by bot', () => {
    expect(
      canAutoChargeStoredMethod(
        chargeable({ email: 'tg_42@bot.gptweb.ru', tgBotChatId: 42 }),
      ),
    ).toBe(true);
  });

  it('refuses when auto-renewal is off', () => {
    expect(canAutoChargeStoredMethod(chargeable({ autoRenew: false }))).toBe(false);
  });

  it('refuses when there is no stored token', () => {
    expect(canAutoChargeStoredMethod(chargeable({ paymentMethodId: null }))).toBe(false);
  });

  // The belt-and-braces case: a token left behind on a cancelled row (manual
  // DB fix, future partial-cancel flow) must still never be used.
  it('refuses a cancelled row even if a token somehow survived', () => {
    expect(
      canAutoChargeStoredMethod(
        chargeable({ autoRenew: true, cancelledAt: new Date('2026-09-20T00:00:00Z') }),
      ),
    ).toBe(false);
  });

  it('refuses when the mandatory pre-charge notice has no channel at all', () => {
    expect(
      canAutoChargeStoredMethod(
        chargeable({ email: 'tg_42@bot.gptweb.ru', tgBotChatId: null }),
      ),
    ).toBe(false);
    expect(canAutoChargeStoredMethod(chargeable({ email: null, tgBotChatId: null }))).toBe(false);
  });
});
