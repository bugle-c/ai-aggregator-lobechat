/**
 * /billing/start?plan=<id>
 *
 * Bot deeplink landing page. Auto-creates a YooKassa payment for the given
 * plan and immediately redirects the user to the hosted payment page.
 * Requires an active session — unauthenticated visitors are sent to /login.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { type FC } from 'react';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ plan?: string }>;
}

const BillingStartPage: FC<Props> = async ({ searchParams }) => {
  const { plan: planParam } = await searchParams;

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

  // --- Create payment server-side via the subscription router ---
  try {
    const { getServerDB } = await import('@/database/core/db-adaptor');
    const { lambdaRouter } = await import('@/server/routers/lambda');
    const { createCallerFactory } = await import('@/libs/trpc/lambda');

    const db = await getServerDB();
    const createCaller = createCallerFactory(lambdaRouter);
    const caller = createCaller({ userId, serverDB: db } as any);

    const { paymentUrl } = await caller.subscription.createPayment({ planId });

    if (paymentUrl) redirect(paymentUrl);
    throw new Error('Payment URL missing');
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
