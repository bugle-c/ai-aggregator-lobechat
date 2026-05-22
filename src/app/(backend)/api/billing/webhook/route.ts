import { eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { billingPayments } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { cancelPayment, fulfillPayment } from '@/server/modules/billing/fulfill';
import {
  extractMetadataPatch,
  type YookassaPaymentObject,
} from '@/server/modules/billing/parse-yk-payload';

interface YookassaWebhookPayload {
  event: string;
  object: YookassaPaymentObject;
  type: string;
}

export const POST = async (req: Request): Promise<NextResponse> => {
  try {
    const payload: YookassaWebhookPayload = await req.json();
    const db = await getServerDB();

    console.info(`[billing webhook] event=${payload.event} payment_id=${payload.object?.id}`);

    // Merge telemetry (cancellation_details + payment_method) into
    // billing_payments.metadata for EVERY event we receive. Idempotent
    // because we use jsonb || (right-side overwrites overlapping keys).
    const patch = extractMetadataPatch(payload.object);
    if (Object.keys(patch).length > 0) {
      await db
        .update(billingPayments)
        .set({
          metadata: sql`COALESCE(${billingPayments.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(billingPayments.yookassaPaymentId, payload.object.id));
    }

    switch (payload.event) {
      case 'payment.succeeded': {
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
