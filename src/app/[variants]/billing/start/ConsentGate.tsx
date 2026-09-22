'use client';

import { memo, useState } from 'react';

import {
  RECURRING_CONSENT_VERSION,
  RECURRING_PAY_LABEL,
  recurringConsentText,
} from '@/business/client/recurringDisclosure';

interface Props {
  planId: number;
  planName: string;
  priceRub: number;
}

/**
 * ФЗ от 15.10.2025 № 376-ФЗ (ст. 16.1 ЗПП) — explicit, separate consent for
 * the Telegram-bot deeplink.
 *
 * Every other checkout surface uses statement-on-action: the user is standing
 * on a plans screen they navigated to and presses a button labelled
 * «Оплатить». Here they arrive from OUTSIDE the app, having seen no plan
 * screen — and the page used to create the payment and bounce them straight
 * to YooKassa with no action of their own at all. That one-tap-from-a-bot
 * shape is exactly what the Perm Роспотребнадзор cases punished, so this
 * surface gets the stricter form: an UNTICKED checkbox that gates the button.
 *
 * Ticking it navigates to the same route with `?consent=<version>`, which is
 * what makes the server create the payment and stamp the consent record onto
 * the payment row.
 */
const ConsentGate = memo<Props>(({ planId, planName, priceRub }) => {
  const [agreed, setAgreed] = useState(false);

  return (
    <div
      style={{ fontFamily: 'sans-serif', margin: '64px auto', maxWidth: 480, padding: '0 16px' }}
    >
      <h2 style={{ marginBottom: 8 }}>Оформление подписки</h2>
      <p style={{ fontSize: 16, margin: '0 0 4px' }}>
        <strong>{planName}</strong> — {priceRub} ₽ за 30 дней
      </p>
      <p style={{ color: '#666', fontSize: 14, margin: '0 0 20px' }}>
        Подписка продлевается автоматически, пока вы её не отмените. Отменить можно в любой момент
        в настройках — доступ сохранится до конца оплаченного периода.
      </p>

      <label
        htmlFor="recurring-consent"
        style={{
          alignItems: 'flex-start',
          border: '1px solid #ddd',
          borderRadius: 8,
          cursor: 'pointer',
          display: 'flex',
          fontSize: 14,
          gap: 10,
          lineHeight: 1.45,
          padding: 12,
        }}
      >
        <input
          checked={agreed}
          id="recurring-consent"
          style={{ flexShrink: 0, marginTop: 2 }}
          type="checkbox"
          onChange={(e) => setAgreed(e.target.checked)}
        />
        <span>{recurringConsentText(priceRub)}</span>
      </label>

      <button
        disabled={!agreed}
        type="button"
        style={{
          background: agreed ? '#1677ff' : '#c8c8c8',
          border: 'none',
          borderRadius: 8,
          color: '#fff',
          cursor: agreed ? 'pointer' : 'not-allowed',
          fontSize: 16,
          fontWeight: 500,
          marginTop: 16,
          padding: '12px 24px',
          width: '100%',
        }}
        onClick={() => {
          if (!agreed) return;
          window.location.href = `/billing/start?plan=${planId}&consent=${RECURRING_CONSENT_VERSION}`;
        }}
      >
        {RECURRING_PAY_LABEL}
      </button>
    </div>
  );
});

ConsentGate.displayName = 'ConsentGate';

export default ConsentGate;
