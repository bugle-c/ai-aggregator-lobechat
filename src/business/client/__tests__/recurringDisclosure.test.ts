import { describe, expect, it } from 'vitest';

import {
  buildConsentRecord,
  CONSENT_SURFACES,
  RECURRING_CONSENT_VERSION,
  RECURRING_PAY_LABEL,
  recurringConsentText,
} from '../recurringDisclosure';

describe('recurringConsentText', () => {
  it('binds the consent to the pay action, the real price and the way out', () => {
    expect(recurringConsentText(490)).toBe(
      'Нажимая «Оплатить», вы соглашаетесь на автоматическое продление подписки по 490 ₽ ' +
        'каждые 30 дней. Отменить можно в любой момент в настройках.',
    );
  });

  it('quotes the very label the button carries — they cannot drift apart', () => {
    expect(recurringConsentText(1290)).toContain(`«${RECURRING_PAY_LABEL}»`);
  });

  it('uses whatever price it is given', () => {
    expect(recurringConsentText(1290)).toContain('по 1290 ₽');
  });

  it('names the period and the cancel path explicitly (ФЗ 376 minimum)', () => {
    const text = recurringConsentText(490);
    expect(text).toContain('каждые 30 дней');
    expect(text).toContain('Отменить можно в любой момент в настройках');
  });
});

describe('buildConsentRecord', () => {
  it('snapshots the exact text, the version and the surface', () => {
    const record = buildConsentRecord({
      acceptedAt: new Date('2026-10-01T10:00:00Z'),
      priceRub: 490,
      surface: 'plans_desktop',
      version: RECURRING_CONSENT_VERSION,
    });

    expect(record).toEqual({
      accepted_at: '2026-10-01T10:00:00.000Z',
      surface: 'plans_desktop',
      text: recurringConsentText(490),
      version: 'fz376-2026-10-v1',
    });
  });

  it('rebuilds the text from the server-known price, never from the client', () => {
    // A client claiming a 1 ₽ plan cannot change what gets recorded: only the
    // surface and version travel over the wire.
    const record = buildConsentRecord({
      priceRub: 990,
      surface: 'credits_exhausted',
      version: 'whatever-the-client-said',
    });
    expect(record.text).toContain('по 990 ₽');
  });

  it('covers every checkout surface', () => {
    for (const surface of CONSENT_SURFACES) {
      expect(buildConsentRecord({ priceRub: 490, surface, version: 'v' }).surface).toBe(surface);
    }
  });
});
