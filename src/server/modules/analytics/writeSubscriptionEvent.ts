import { billingSubscriptionEvents } from '@/database/schemas/analytics';
import { type LobeChatDatabase } from '@/database/type';

export type SubscriptionEventType =
  | 'created'
  | 'upgraded'
  | 'downgraded'
  | 'renewed'
  | 'reactivation'
  | 'cancelled';

export interface ClassifyInput {
  currentExpiresAt: Date | null;
  fromPlanPrice: number; // RUB/month, 0 for free or cancelled
  toPlanPrice: number; // RUB/month, 0 for cancellation
}

export function classifySubscriptionEvent(input: ClassifyInput): {
  eventType: SubscriptionEventType;
  mrrDeltaRub: number;
} {
  const { fromPlanPrice, toPlanPrice, currentExpiresAt } = input;

  if (toPlanPrice === 0 && fromPlanPrice > 0) {
    return { eventType: 'cancelled', mrrDeltaRub: -fromPlanPrice };
  }

  const wasActive =
    fromPlanPrice > 0 && !!currentExpiresAt && currentExpiresAt.getTime() > Date.now();

  if (fromPlanPrice === 0 || !wasActive) {
    return {
      eventType: fromPlanPrice === 0 ? 'created' : 'reactivation',
      mrrDeltaRub: toPlanPrice,
    };
  }

  if (toPlanPrice > fromPlanPrice) {
    return { eventType: 'upgraded', mrrDeltaRub: toPlanPrice - fromPlanPrice };
  }
  if (toPlanPrice < fromPlanPrice) {
    return { eventType: 'downgraded', mrrDeltaRub: toPlanPrice - fromPlanPrice };
  }
  return { eventType: 'renewed', mrrDeltaRub: 0 };
}

export interface WriteSubscriptionEventInput {
  currentExpiresAt: Date | null;
  fromPlanId: number | null;
  fromPlanPrice: number;
  paymentId?: string | null;
  toPlanId: number | null;
  toPlanPrice: number;
  userId: string;
}

export async function writeSubscriptionEvent(
  db: LobeChatDatabase,
  input: WriteSubscriptionEventInput,
): Promise<void> {
  try {
    const { eventType, mrrDeltaRub } = classifySubscriptionEvent(input);
    await db.insert(billingSubscriptionEvents).values({
      userId: input.userId,
      eventType,
      fromPlanId: input.fromPlanId,
      toPlanId: input.toPlanId,
      mrrDeltaRub,
      paymentId: input.paymentId ?? null,
    });
  } catch (error) {
    console.error('[analytics] writeSubscriptionEvent error:', error);
  }
}
