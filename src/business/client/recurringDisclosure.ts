/**
 * Single source of truth for the recurring-payment CONSENT shown at the
 * moment of payment.
 *
 * ФЗ от 15.10.2025 № 376-ФЗ (ст. 16.1 ЗПП, in force 2026-03-01) requires an
 * explicit, unambiguous consent to recurring charges tied to the payment
 * action itself — an informational line next to the button is not enough,
 * it has to say what pressing THAT button means.
 *
 * Every subscription checkout saves the card (`savePaymentMethod` in
 * subscription.createPayment) and the renew-due-subscriptions cron charges it
 * off-session. So every surface that can start a subscription checkout — the
 * desktop plans grid, the mobile plans layout, the credits-exhausted paywall
 * and the /billing/start deeplink — must render `recurringConsentText()`
 * against a button labelled `RECURRING_PAY_LABEL`, and must pass its
 * `ConsentSurface` to `createPayment` so the server can persist the evidence.
 *
 * Form of consent per surface (documented decision):
 *   - in-app surfaces (plans desktop/mobile, credits-exhausted paywall):
 *     STATEMENT-ON-ACTION. The user deliberately navigated to a paid-plan
 *     screen and presses a button labelled «Оплатить»; RU practice accepts an
 *     unambiguous statement bound to the action, and a pre-ticked box is
 *     forbidden anyway.
 *   - /billing/start (Telegram-bot deeplink): SEPARATE UNTICKED CHECKBOX.
 *     The user arrives from an external context having seen no plan screen —
 *     that one-tap pattern is exactly what the Perm Роспотребнадзор cases
 *     punished, so it gets the stricter form.
 *
 * Pure string builder — no React, no 'use client' — so server code (the
 * /billing/start page and subscription.createPayment) can import it too.
 */

/**
 * Bump on ANY wording change. Stored verbatim on the payment row so an old
 * charge can always be traced back to the exact text its payer agreed to.
 */
export const RECURRING_CONSENT_VERSION = 'fz376-2026-10-v1';

/** Billing period named in the consent. Matches fulfill.ts (+30 days). */
export const RECURRING_PERIOD_DAYS = 30;

/**
 * The ONE label every subscription pay-button carries. The consent statement
 * quotes it verbatim («Нажимая «Оплатить», …»), so there is exactly one
 * string and no way for the button and the statement to drift apart.
 * «Выбрать» / «Продолжить общение» are not payment words — a button that
 * takes money has to say so.
 */
export const RECURRING_PAY_LABEL = 'Оплатить';

/** Checkout surfaces that can start a recurring subscription. */
export const CONSENT_SURFACES = [
  'plans_desktop',
  'plans_mobile',
  'credits_exhausted',
  'billing_start',
  /** Stale client bundle that predates consent capture — recorded, not trusted. */
  'unknown',
] as const;

export type ConsentSurface = (typeof CONSENT_SURFACES)[number];

/**
 * «Нажимая «Оплатить», вы соглашаетесь на автоматическое продление подписки
 * по 490 ₽ каждые 30 дней. Отменить можно в любой момент в настройках.»
 */
export const recurringConsentText = (priceRub: number): string =>
  `Нажимая «${RECURRING_PAY_LABEL}», вы соглашаетесь на автоматическое продление ` +
  `подписки по ${priceRub} ₽ каждые ${RECURRING_PERIOD_DAYS} дней. ` +
  `Отменить можно в любой момент в настройках.`;

export interface RecurringConsentRecord {
  accepted_at: string;
  surface: ConsentSurface;
  text: string;
  version: string;
}

/**
 * Audit record stored on `billing_payments.metadata.recurring_consent`.
 *
 * The TEXT is rebuilt server-side from the server-known price — the client
 * only says WHICH surface it rendered and WHICH version it had, so the record
 * cannot be forged into something the user never saw.
 */
export const buildConsentRecord = (args: {
  acceptedAt?: Date;
  priceRub: number;
  surface: ConsentSurface;
  version: string;
}): RecurringConsentRecord => ({
  accepted_at: (args.acceptedAt ?? new Date()).toISOString(),
  surface: args.surface,
  text: recurringConsentText(args.priceRub),
  version: args.version,
});
