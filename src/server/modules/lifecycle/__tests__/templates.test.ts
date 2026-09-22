import { describe, expect, it } from 'vitest';

import {
  buildCancellationConfirmedEmail,
  buildExpiryReminderEmail,
  buildRenewalFailedEmail,
  buildSubscriptionConfirmationEmail,
  buildUpcomingChargeEmail,
} from '../templates';

const EXPIRES = new Date('2026-10-03T09:00:00Z');

describe('buildSubscriptionConfirmationEmail', () => {
  it('discloses the auto-renewal with the concrete next-charge date and amount', () => {
    const { html, textBody } = buildSubscriptionConfirmationEmail({
      autoRenew: true,
      creditAmount: 100_000,
      expiresAt: EXPIRES,
      planName: 'Pro',
      priceRub: 490,
    });

    const expected = 'Продлевается автоматически 03 октября 2026 г. по 490 ₽/мес';
    expect(html).toContain(expected);
    expect(textBody).toContain(expected);
    expect(textBody).toContain('отменить можно в любой момент');
  });

  it('omits the renewal line when no card was saved (one-shot purchase)', () => {
    const { html, textBody } = buildSubscriptionConfirmationEmail({
      autoRenew: false,
      creditAmount: 100_000,
      expiresAt: EXPIRES,
      planName: 'Pro',
      priceRub: 490,
    });

    expect(html).not.toContain('Продлевается автоматически');
    expect(textBody).not.toContain('Продлевается автоматически');
  });

  it('omits the renewal line when the price is unknown', () => {
    const { html } = buildSubscriptionConfirmationEmail({
      autoRenew: true,
      creditAmount: 100_000,
      expiresAt: EXPIRES,
      planName: 'Pro',
    });

    expect(html).not.toContain('Продлевается автоматически');
  });

  it('still reports the activation itself', () => {
    const { subject, html } = buildSubscriptionConfirmationEmail({
      autoRenew: true,
      creditAmount: 100_000,
      expiresAt: EXPIRES,
      planName: 'Pro',
      priceRub: 490,
    });

    expect(subject).toContain('активирована');
    expect(html).toContain('Pro');
    // ru-RU groups with a non-breaking space
    expect(html).toContain(`<strong>${(100_000).toLocaleString('ru-RU')}</strong>`);
  });
});

describe('buildUpcomingChargeEmail', () => {
  it('states the date and the exact amount that will be charged', () => {
    const { subject, html, textBody } = buildUpcomingChargeEmail({
      amountRub: 490,
      chargeAt: EXPIRES,
      planName: 'Pro',
    });

    const notice = '03 октября 2026 г. спишем 490 ₽ — отменить можно в настройках.';
    expect(html).toContain(notice);
    expect(textBody).toContain(notice);
    expect(subject).toContain('продлим');
  });

  it('never tells an auto-renewing user to renew manually', () => {
    const { html, textBody, subject } = buildUpcomingChargeEmail({
      amountRub: 490,
      chargeAt: EXPIRES,
      planName: 'Pro',
    });

    for (const s of [subject, textBody]) expect(s).not.toContain('истекает');
    expect(html).not.toContain('Продлить подписку');
  });

  it('quotes the amount it is given, not a list price', () => {
    const { textBody } = buildUpcomingChargeEmail({
      amountRub: 390,
      chargeAt: EXPIRES,
      planName: 'Pro',
    });
    expect(textBody).toContain('спишем 390 ₽');
  });
});

describe('buildRenewalFailedEmail', () => {
  it('asks the user to update the card, not to finish a payment', () => {
    const { subject, html, textBody } = buildRenewalFailedEmail({
      amountRub: 490,
      planName: 'Pro',
    });

    expect(subject).toContain('Не удалось продлить подписку');
    expect(subject).toContain('обновите карту');
    expect(html).toContain('Не удалось продлить подписку');
    expect(textBody).toContain('обновите карту');
    // The checkout-recovery framing would be a lie: the user started nothing.
    expect(html).not.toContain('не закончили оплату');
    expect(textBody).toContain('490 ₽');
  });

  it('escapes the plan name', () => {
    const { html } = buildRenewalFailedEmail({ amountRub: 490, planName: '<b>Pro</b>' });
    expect(html).toContain('&lt;b&gt;Pro&lt;/b&gt;');
  });
});

describe('buildExpiryReminderEmail (unchanged manual-renewal path)', () => {
  it('still tells a non-renewing user that the plan expires', () => {
    const { subject, html } = buildExpiryReminderEmail({ expiresAt: EXPIRES, planName: 'Pro' });
    expect(subject).toContain('истекает');
    expect(html).toContain('Продлить подписку');
  });
});

// ФЗ 376 / ст. 16.1 ЗПП — the refusal has to be confirmed in writing, and the
// confirmation has to say that no further money will be taken.
describe('buildCancellationConfirmedEmail', () => {
  const ACTIVE_UNTIL = new Date('2026-10-20T00:00:00Z');

  it('states that no further charges will occur', () => {
    const { subject, html, textBody } = buildCancellationConfirmedEmail({
      activeUntil: ACTIVE_UNTIL,
      planName: 'Pro',
    });
    expect(subject).toContain('списаний больше не будет');
    expect(html).toContain('Списаний больше не будет');
    expect(textBody).toContain('Списаний больше не будет');
  });

  it('states that the stored card details are gone', () => {
    const { textBody } = buildCancellationConfirmedEmail({
      activeUntil: ACTIVE_UNTIL,
      planName: 'Pro',
    });
    expect(textBody).toContain('Сохранённая карта удалена');
  });

  it('keeps the paid-through date — a refusal is not a forfeit', () => {
    const { textBody } = buildCancellationConfirmedEmail({
      activeUntil: ACTIVE_UNTIL,
      planName: 'Pro',
    });
    expect(textBody).toContain('20 октября 2026');
    expect(textBody).toContain('сохраняется до');
  });

  it('drops the date line when the plan has already lapsed', () => {
    const { textBody } = buildCancellationConfirmedEmail({ activeUntil: null, planName: 'Pro' });
    expect(textBody).toContain('бесплатный тариф');
    expect(textBody).not.toContain('сохраняется до');
  });

  it('escapes the plan name', () => {
    const { html } = buildCancellationConfirmedEmail({
      activeUntil: ACTIVE_UNTIL,
      planName: '<b>Pro</b>',
    });
    expect(html).toContain('&lt;b&gt;Pro&lt;/b&gt;');
  });
});

// ФЗ 376: the pre-charge notice must name the sum, the date and the way out.
describe('buildUpcomingChargeEmail (ФЗ 376 minimum content)', () => {
  it('names the exact sum, the exact date and the cancel path', () => {
    const { html, textBody } = buildUpcomingChargeEmail({
      amountRub: 490,
      chargeAt: new Date('2026-10-03T09:00:00Z'),
      planName: 'Pro',
    });
    expect(textBody).toContain('490 ₽');
    expect(textBody).toContain('03 октября 2026');
    expect(textBody).toContain('отменить можно в настройках');
    expect(html).toContain('/settings/plans');
  });
});
