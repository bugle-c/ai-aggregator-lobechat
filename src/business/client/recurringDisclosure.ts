/**
 * Single source of truth for the pre-checkout recurring-payment disclosure.
 *
 * Every subscription checkout saves the card (`savePaymentMethod` in
 * subscription.createPayment) and the renew-due-subscriptions cron charges it
 * off-session. The user must be told that BEFORE they pay — on every surface
 * that can start a subscription checkout: the desktop plans grid, the mobile
 * plans layout, the credits-exhausted paywall and the /billing/start deeplink.
 *
 * Pure string builder — no React, no 'use client' — so server components
 * (the /billing/start page) can import it too.
 */

/** «Продлевается автоматически по 490 ₽/мес, отменить можно в любой момент» */
export const recurringDisclosure = (priceRub: number): string =>
  `Продлевается автоматически по ${priceRub} ₽/мес, отменить можно в любой момент`;
