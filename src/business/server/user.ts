import { type ReferralStatusString } from '@lobechat/types';
import { Plans } from '@lobechat/types';
import { eq } from 'drizzle-orm';

import { getServerDB } from '@/database/core/db-adaptor';
import { userBilling } from '@/database/schemas';
import { fetchPlanById } from '@/server/services/billing/plans-source';

const PLAN_SLUG_TO_ENUM: Record<string, Plans> = {
  basic: Plans.Basic,
  free: Plans.Free,
  pro: Plans.Pro,
};

export async function getReferralStatus(userId: string): Promise<ReferralStatusString | undefined> {
  return undefined;
}

export async function getSubscriptionPlan(userId: string): Promise<Plans> {
  try {
    const db = await getServerDB();
    const [billing] = await db
      .select()
      .from(userBilling)
      .where(eq(userBilling.userId, userId))
      .limit(1);

    if (!billing) return Plans.Free;

    // Check if subscription expired
    if (billing.subscriptionExpiresAt && new Date(billing.subscriptionExpiresAt) < new Date()) {
      return Plans.Free;
    }

    const plan = await fetchPlanById(billing.planId);

    return PLAN_SLUG_TO_ENUM[plan?.slug || 'free'] || Plans.Free;
  } catch (error) {
    console.error('[billing] getSubscriptionPlan error:', error);
    return Plans.Free;
  }
}

export async function initNewUserForBusiness(
  userId: string,
  createdAt: Date | null | undefined,
): Promise<void> {
  try {
    const db = await getServerDB();
    await db.insert(userBilling).values({ userId }).onConflictDoNothing();
  } catch (error) {
    console.error('[billing] initNewUserForBusiness error:', error);
  }
}
