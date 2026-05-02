import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/server';
import { cancelPayment, fulfillPayment } from '@/server/modules/billing/fulfill';

interface YookassaWebhookPayload {
  event: string;
  object: {
    id: string;
    metadata?: Record<string, string>;
    payment_method?: { id?: string; saved?: boolean; type?: string };
    status: string;
  };
  type: string;
}

export const POST = async (req: Request): Promise<NextResponse> => {
  try {
    const payload: YookassaWebhookPayload = await req.json();
    const db = await getServerDB();

    console.info(`[billing webhook] event=${payload.event} payment_id=${payload.object?.id}`);

    switch (payload.event) {
      case 'payment.succeeded': {
        // Pass the saved payment_method.id (when present) through to
        // fulfill so it can persist on user_billing for the renew loop.
        const savedMethodId =
          payload.object.payment_method?.saved && payload.object.payment_method.id
            ? payload.object.payment_method.id
            : undefined;
        await fulfillPayment(db, payload.object.id, { savedPaymentMethodId: savedMethodId });
        break;
      }
      case 'payment.canceled': {
        await cancelPayment(db, payload.object.id);
        break;
      }
      default: {
        console.info(`[billing webhook] unhandled event: ${payload.event}`);
      }
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('[billing webhook] error:', error);
    return NextResponse.json({ status: 'error' });
  }
};
