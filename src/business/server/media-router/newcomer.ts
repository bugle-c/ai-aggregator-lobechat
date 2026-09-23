/**
 * "Newcomer" = a free-plan user who never paid, was not granted a plan by an
 * admin, and registered within the last `NEWCOMER_WINDOW_DAYS`. While a
 * newcomer has fewer than `NEWCOMER_IMAGE_THRESHOLD` successful images, the
 * image picker defaults to Nano Banana instead of flux-schnell (owner's
 * rule, 2026-09-22): the first pictures should come from the strongest cheap
 * model, and the router pool renders them at zero cost to us.
 */
import { and, count, eq, isNotNull } from 'drizzle-orm';

import { billingPayments } from '@/database/schemas/billing';
import { generations } from '@/database/schemas/generation';
import { users } from '@/database/schemas/user';
import { type LobeChatDatabase } from '@/database/type';
import { FREE_PLAN_SLUG } from '@/server/modules/billing/daily-quota';
import { BillingService } from '@/server/services/billing';

export const NEWCOMER_WINDOW_DAYS = Number(process.env.NEWCOMER_WINDOW_DAYS ?? 7);
export const NEWCOMER_IMAGE_THRESHOLD = Number(process.env.NEWCOMER_IMAGE_THRESHOLD ?? 3);

export interface NewcomerState {
  /** Newcomer window is open (plan/payment/age checks). */
  active: boolean;
  /** Successful images (asset present) the user has ever generated. */
  imagesGenerated: number;
  /** `active && imagesGenerated < threshold` — the picker should default to Nano Banana. */
  nanoBananaDefault: boolean;
  threshold: number;
}

export async function countUserImages(db: LobeChatDatabase, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(generations)
    .where(and(eq(generations.userId, userId), isNotNull(generations.asset)));
  return Number(row?.n ?? 0);
}

async function hasEverPaid(db: LobeChatDatabase, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(billingPayments)
    .where(and(eq(billingPayments.userId, userId), eq(billingPayments.status, 'succeeded')));
  return Number(row?.n ?? 0) > 0;
}

export async function getNewcomerState(
  db: LobeChatDatabase,
  userId: string,
  planSlug: string | undefined,
  now = new Date(),
): Promise<NewcomerState> {
  const imagesGenerated = await countUserImages(db, userId);
  const base = { imagesGenerated, threshold: NEWCOMER_IMAGE_THRESHOLD };
  // Admin-granted plans are never `free`, so the plan check covers them too.
  if (planSlug !== FREE_PLAN_SLUG) {
    return { ...base, active: false, nanoBananaDefault: false };
  }
  const [u] = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const ageMs = u?.createdAt ? now.getTime() - new Date(u.createdAt).getTime() : Infinity;
  const withinWindow = ageMs <= NEWCOMER_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const active = withinWindow && !(await hasEverPaid(db, userId));
  return {
    ...base,
    active,
    nanoBananaDefault: active && imagesGenerated < NEWCOMER_IMAGE_THRESHOLD,
  };
}

/** Convenience for server paths that only have db + userId (async routers). */
export async function isNewcomerUser(db: LobeChatDatabase, userId: string): Promise<boolean> {
  const planSlug = await new BillingService(db, userId).getUserPlanSlug();
  return (await getNewcomerState(db, userId, planSlug)).active;
}
