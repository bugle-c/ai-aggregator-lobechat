import { NextResponse } from 'next/server';

import { getServerDB } from '@/database/server';
import { cancelPayment, fulfillPayment } from '@/server/modules/billing/fulfill';

interface YookassaWebhookPayload {
  event: string;
  object: {
    id: string;
    metadata?: Record<string, string>;
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
        await fulfillPayment(db, payload.object.id);
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
