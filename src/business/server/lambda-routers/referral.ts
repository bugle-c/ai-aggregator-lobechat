import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, sql, sum } from 'drizzle-orm';
import { z } from 'zod';

import { cashoutRequests, referrals, userBilling, users } from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { generateReferralCode } from '@/server/modules/referrals/antiAbuse';

// ============ Constants ============ //

/** RUB earned per credit when cashed out (3× worse than in-product 0.15 ₽). */
const CASHOUT_RATE_RUB_PER_CREDIT = 0.05;
/** Minimum credits per cashout request. Cuts dust + admin overhead. */
const CASHOUT_MIN_CREDITS = 5000;

// ============ Helpers ============ //

/**
 * Mask an email for display. Keeps first 2 chars of local part, replaces
 * the rest with `*`, keeps domain. `alex@gmail.com` → `al**@gmail.com`.
 * Light privacy guard — the referrer once knew these emails (they invited
 * them) but masking prevents enumeration via the UI.
 */
function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const head = local.slice(0, 2);
  const masked = head + '*'.repeat(Math.max(local.length - 2, 1));
  return `${masked}@${domain}`;
}

// ============ Procedures ============ //

const refProcedure = authedProcedure.use(serverDatabase);

export const referralRouter = router({
  /**
   * Returns the current user's referral state: their code (auto-generated on
   * first call if missing), aggregate counters of their downstream activity,
   * and the cashout config the UI needs to render rate / minimum.
   */
  getMyState: refProcedure.query(async ({ ctx }) => {
    const userId = ctx.userId;

    // Fetch (and lazily backfill) the user's referral code. Existing rows
    // pre-dating this feature have NULL code; generate one with up to 5
    // retries on unique-collision (collision rate is essentially nil).
    let code: string | null = null;
    {
      const row = await ctx.serverDB
        .select({ referralCode: users.referralCode })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      code = row[0]?.referralCode ?? null;
    }

    if (!code) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generateReferralCode();
        try {
          await ctx.serverDB
            .update(users)
            .set({ referralCode: candidate })
            .where(eq(users.id, userId));
          code = candidate;
          break;
        } catch (error) {
          // Unique violation → retry with a fresh code.
          if (attempt === 4) throw error;
        }
      }
    }

    // Aggregate stats:
    //   - totalReferred: distinct people directly invited (level=1 only)
    //   - totalRewarded: rows that have flipped to 'rewarded' (paid friends)
    //   - totalCreditsEarned: sum of credits credited across L1 + L2 income
    const [referredRow] = await ctx.serverDB
      .select({ value: count() })
      .from(referrals)
      .where(and(eq(referrals.referrerUserId, userId), eq(referrals.level, 1)));

    const [rewardedRow] = await ctx.serverDB
      .select({ value: count() })
      .from(referrals)
      .where(and(eq(referrals.referrerUserId, userId), eq(referrals.status, 'rewarded')));

    const [creditsRow] = await ctx.serverDB
      .select({ value: sum(referrals.creditsAwarded) })
      .from(referrals)
      .where(and(eq(referrals.referrerUserId, userId), eq(referrals.status, 'rewarded')));

    const [billingRow] = await ctx.serverDB
      .select({ tokenBalance: userBilling.tokenBalance })
      .from(userBilling)
      .where(eq(userBilling.userId, userId))
      .limit(1);

    return {
      code: code!,
      totalReferred: Number(referredRow?.value ?? 0),
      totalRewarded: Number(rewardedRow?.value ?? 0),
      totalCreditsEarned: Number(creditsRow?.value ?? 0),
      currentBalance: billingRow?.tokenBalance ?? 0,
      cashout: {
        ratePerCredit: CASHOUT_RATE_RUB_PER_CREDIT,
        minCredits: CASHOUT_MIN_CREDITS,
      },
    };
  }),

  /**
   * Paginated list of the user's referrals with masked emails.
   */
  getMyList: refProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.serverDB
        .select({
          id: referrals.id,
          level: referrals.level,
          status: referrals.status,
          creditsAwarded: referrals.creditsAwarded,
          createdAt: referrals.createdAt,
          rewardedAt: referrals.rewardedAt,
          referredEmail: users.email,
        })
        .from(referrals)
        .leftJoin(users, eq(referrals.referredUserId, users.id))
        .where(eq(referrals.referrerUserId, ctx.userId))
        .orderBy(desc(referrals.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return rows.map((r) => ({
        id: r.id,
        level: r.level,
        status: r.status,
        creditsAwarded: r.creditsAwarded ?? 0,
        createdAt: r.createdAt,
        rewardedAt: r.rewardedAt,
        referredEmailMasked: maskEmail(r.referredEmail),
      }));
    }),

  /**
   * Submit a cashout request. Atomically deducts credits and creates the row.
   * Race-safe: the conditional UPDATE locks the user_billing row, so a
   * parallel charge can't slip in between the read and the deduction.
   *
   * Admin processes the queue manually via /admin/cashouts (T3) and either
   * marks `paid` (with off-platform receipt) or `rejected` (refund credits).
   */
  requestCashout: refProcedure
    .input(
      z.object({
        creditsRequested: z.number().int().min(CASHOUT_MIN_CREDITS),
        paymentMethod: z.string().trim().min(1).max(64),
        paymentDetails: z.string().trim().min(1).max(256),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      const credits = input.creditsRequested;
      const amountRub = Math.round(credits * CASHOUT_RATE_RUB_PER_CREDIT);

      const result = await ctx.serverDB.transaction(async (tx) => {
        // Conditional UPDATE — rowCount=0 means insufficient balance OR no
        // user_billing row. Both are user-actionable errors.
        const updateRes: any = await tx.execute(sql`
          UPDATE user_billing
          SET token_balance = token_balance - ${credits},
              updated_at = now()
          WHERE user_id = ${userId}
            AND token_balance >= ${credits}
        `);
        const rowCount = updateRes?.rowCount ?? updateRes?.rowsAffected ?? null;
        if (rowCount === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Insufficient credits for cashout',
          });
        }

        const inserted = await tx
          .insert(cashoutRequests)
          .values({
            userId,
            creditsRequested: credits,
            rateRubPerCredit: CASHOUT_RATE_RUB_PER_CREDIT.toString(),
            amountRub,
            paymentMethod: input.paymentMethod,
            paymentDetails: input.paymentDetails,
          })
          .returning();

        return inserted[0]!;
      });

      return {
        id: result.id,
        creditsRequested: result.creditsRequested,
        amountRub: result.amountRub,
        status: result.status,
        createdAt: result.createdAt,
      };
    }),

  /**
   * Cashout history for the current user, most recent first. Sensitive
   * payment_details intentionally NOT returned in the list view.
   */
  listMyCashouts: refProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(20),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const rows = await ctx.serverDB
        .select()
        .from(cashoutRequests)
        .where(eq(cashoutRequests.userId, ctx.userId))
        .orderBy(desc(cashoutRequests.createdAt))
        .limit(limit);

      return rows.map((r) => ({
        id: r.id,
        creditsRequested: r.creditsRequested,
        amountRub: r.amountRub,
        rateRubPerCredit: Number(r.rateRubPerCredit),
        status: r.status,
        paymentMethod: r.paymentMethod,
        createdAt: r.createdAt,
        processedAt: r.processedAt,
      }));
    }),
});

// NOTE (T1 dispatch scope): Admin endpoints (`admin.referrals` router) are
// intentionally NOT implemented here. Per dispatch instructions, until an
// `adminProcedure` middleware exists, admin reads/writes happen via the
// sibling `webgpt-admin` Supabase app directly. T3 will revisit.
