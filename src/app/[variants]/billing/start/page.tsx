/**
 * /billing/start?plan=<id>[&consent=<version>]
 *
 * Bot deeplink landing page, in TWO steps since ФЗ 376:
 *
 *   1. no `consent` param → render the consent gate (plan, price, period and
 *      an UNTICKED checkbox). Nothing is charged, nothing is created.
 *   2. `consent=<current version>` → create the YooKassa payment, stamping
 *      the consent record onto the payment row, and redirect to the hosted
 *      payment page.
 *
 * It used to do step 2 unconditionally on first load: the user tapped a
 * button inside Telegram and the next thing they saw was a payment form for
 * a subscription that saves their card — no consent to recurring charges
 * anywhere in the flow. See ConsentGate.tsx for why this surface gets a
 * checkbox while the in-app plans screens use statement-on-action.
 *
 * Requires an active session — unauthenticated visitors are sent to /login.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { type FC } from 'react';

import { RECURRING_CONSENT_VERSION } from '@/business/client/recurringDisclosure';

import CheckoutRedirect from './CheckoutRedirect';
import ConsentGate from './ConsentGate';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ consent?: string; plan?: string }>;
}

const BillingStartPage: FC<Props> = async ({ searchParams }) => {
  const { consent: consentParam, plan: planParam } = await searchParams;

  // --- Auth ---
  const { auth } = await import('@/auth');
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });

  if (!session?.user?.id) {
    redirect('/login');
  }

  const userId = session.user.id;

  // --- Validate plan param ---
  const planId = planParam ? Number(planParam) : NaN;
  if (!planParam || !Number.isInteger(planId) || planId <= 0) {
    return (
      <div
        style={{ fontFamily: 'sans-serif', maxWidth: 480, margin: '80px auto', padding: '0 16px' }}
      >
        <h2>Ошибка</h2>
        <p>Некорректный идентификатор плана. Проверьте ссылку и попробуйте снова.</p>
      </div>
    );
  }

  // --- Plan lookup (needed by both the gate and the disclosure) ---
  // Best-effort: a lookup failure must never block a checkout, so the gate
  // falls through to the old behaviour only when we genuinely cannot price
  // the plan — and then createPayment itself rejects an unknown plan.
  let priceRub: number | null = null;
  let planName = 'Подписка';
  try {
    const { fetchPlanById } = await import('@/server/services/billing/plans-source');
    const found = await fetchPlanById(planId);
    priceRub = found?.priceRub ?? null;
    planName = found?.name ?? planName;
  } catch {
    priceRub = null;
  }

  // --- Step 1: consent gate (ФЗ 376) ---
  // No payment exists until the user ticks the box and comes back with the
  // current consent version. An old/forged version falls back to the gate.
  if (consentParam !== RECURRING_CONSENT_VERSION && priceRub != null && priceRub > 0) {
    return <ConsentGate planId={planId} planName={planName} priceRub={priceRub} />;
  }

  // --- Step 2: create payment server-side via the subscription router ---
  // The redirect to YooKassa is done client-side (CheckoutRedirect) so the
  // Metrika `checkout_start` goal can be fired first.
  try {
    const { getServerDB } = await import('@/database/core/db-adaptor');
    const { lambdaRouter } = await import('@/server/routers/lambda');
    const { createCallerFactory } = await import('@/libs/trpc/lambda');

    const db = await getServerDB();
    const createCaller = createCallerFactory(lambdaRouter);
    const caller = createCaller({ userId, serverDB: db } as any);

    const { paymentUrl } = await caller.subscription.createPayment({
      // ФЗ 376: the checkbox on the gate is the consent; record which surface
      // and wording version it was. The server rebuilds the exact text.
      consent: { surface: 'billing_start', version: RECURRING_CONSENT_VERSION },
      planId,
    });

    if (!paymentUrl) throw new Error('Payment URL missing');

    return <CheckoutRedirect paymentUrl={paymentUrl} priceRub={priceRub} />;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Неизвестная ошибка';

    const isKnown = message === 'Plan not found' || message === 'Cannot purchase free plan';

    return (
      <div
        style={{ fontFamily: 'sans-serif', maxWidth: 480, margin: '80px auto', padding: '0 16px' }}
      >
        <h2>Ошибка оформления подписки</h2>
        <p>
          {isKnown
            ? message === 'Plan not found'
              ? 'Выбранный тариф не найден. Обратитесь в поддержку.'
              : 'Этот тариф нельзя оплатить (бесплатный план).'
            : 'Не удалось создать платёж. Попробуйте позже или обратитесь в поддержку.'}
        </p>
      </div>
    );
  }
};

export default BillingStartPage;
