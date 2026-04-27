/**
 * Referral signup processor.
 *
 * Called from Better Auth's `databaseHooks.user.create.after` for every new
 * user (email/password, magic link, OAuth — all flows funnel through that
 * single hook). Reads the `_ref` cookie set by the landing middleware,
 * validates the code, runs anti-abuse checks, and on success:
 *
 *   - sets `users.referred_by_l1` and `users.referred_by_l2` on the new user
 *   - creates `referrals` rows (L1 always, L2 if grand-parent exists)
 *   - awards +20 welcome credits to the new user's `user_billing.token_balance`
 *
 * Always also generates a fresh `referral_code` for the new user so they can
 * invite others immediately.
 *
 * Failure-tolerant: any error inside this function is caught and logged. We
 * MUST NOT block signup on a referral-side issue — the welcome bonus is a
 * nice-to-have, not a critical path.
 */
import { eq, sql } from 'drizzle-orm';

import { referrals, users } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';

import {
  generateReferralCode,
  ipVelocityCheck,
  isDisposableEmail,
  selfReferCheck,
} from './antiAbuse';

/** Welcome credits awarded to a referred user on successful signup. */
export const REFERRAL_WELCOME_CREDITS = 20;

/**
 * Read the `_ref` cookie value from a Cookie header string. Returns null if
 * absent or malformed. Lightweight implementation — avoids pulling a cookie
 * parsing dep just for this single read.
 */
export function readRefCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|; )_ref=([^;]+)/);
  if (!match) return null;
  // Cookie values are URL-encoded by browsers; decode safely.
  try {
    const decoded = decodeURIComponent(match[1]);
    // Codes are 8 chars [a-z0-9]. Reject anything that doesn't match shape —
    // both as a sanity check and to avoid SQL/DB hiccups on garbage input.
    if (!/^[a-z0-9]{8}$/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Generate a unique referral code for `userId`. Retries up to 5x on collision.
 * Idempotent: if the user already has one, returns it without writing.
 */
export async function ensureReferralCode(db: LobeChatDatabase, userId: string): Promise<string> {
  const existing = await db
    .select({ code: users.referralCode })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (existing[0]?.code) return existing[0].code;

  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateReferralCode();
    try {
      await db.update(users).set({ referralCode: candidate }).where(eq(users.id, userId));
      return candidate;
    } catch (error) {
      if (attempt === 4) throw error;
      // unique-violation → retry
    }
  }
  throw new Error('Failed to generate unique referral_code after 5 attempts');
}

interface ProcessSignupArgs {
  cookieHeader?: string | null;
  /** For passive IP velocity flagging. Optional. */
  ip?: string | null;
  newUserEmail?: string | null;
  newUserId: string;
}

/**
 * Main entry point. Runs the full referral pipeline for a new signup. Never
 * throws — all errors are caught and logged so signup completion isn't
 * affected by referral-side failures.
 */
export async function processReferralSignup(
  db: LobeChatDatabase,
  args: ProcessSignupArgs,
): Promise<void> {
  try {
    // Always give every new user a referral code, regardless of whether
    // THEY were referred. This way they can immediately invite others.
    await ensureReferralCode(db, args.newUserId);

    const refCode = readRefCookie(args.cookieHeader);
    if (!refCode) return;

    // Look up the referrer by code.
    const referrerRows = await db
      .select({
        id: users.id,
        email: users.email,
        referredByL1: users.referredByL1,
      })
      .from(users)
      .where(eq(users.referralCode, refCode))
      .limit(1);

    const referrer = referrerRows[0];
    if (!referrer) {
      // Stale or invalid cookie — silent no-op, organic signup.
      return;
    }

    // ====== Anti-abuse gating ====== //
    if (isDisposableEmail(args.newUserEmail)) {
      console.info(
        `[referrals] skipping disposable email referral: code=${refCode} new_user=${args.newUserId}`,
      );
      return;
    }

    const selfRefer = selfReferCheck({
      referrerUserId: referrer.id,
      referrerEmail: referrer.email,
      newUserId: args.newUserId,
      newUserEmail: args.newUserEmail,
    });
    if (!selfRefer.ok) {
      console.info(
        `[referrals] skipping self-refer: reason=${selfRefer.reason} new_user=${args.newUserId}`,
      );
      return;
    }

    // Passive — flagged but not blocking. Logged for admin review.
    const velocity = await ipVelocityCheck(db, { ip: args.ip, refCode });
    if (velocity.flagged) {
      console.warn(
        `[referrals] ip-velocity flag: code=${refCode} ip=${args.ip} count=${velocity.count}`,
      );
      // Keep going — don't block, just log.
    }

    // ====== Apply referral state in a transaction ====== //
    await db.transaction(async (tx) => {
      // Mark the new user as referred.
      await tx
        .update(users)
        .set({
          referredByL1: referrer.id,
          referredByL2: referrer.referredByL1 ?? null,
        })
        .where(eq(users.id, args.newUserId));

      // L1 referral row.
      await tx
        .insert(referrals)
        .values({
          referrerUserId: referrer.id,
          referredUserId: args.newUserId,
          level: 1,
          status: 'pending',
        })
        .onConflictDoNothing();

      // L2 referral row only if a grand-parent exists and isn't the new user.
      if (referrer.referredByL1 && referrer.referredByL1 !== args.newUserId) {
        await tx
          .insert(referrals)
          .values({
            referrerUserId: referrer.referredByL1,
            referredUserId: args.newUserId,
            level: 2,
            status: 'pending',
          })
          .onConflictDoNothing();
      }

      // Welcome bonus: +20 credits to the new user. We use raw SQL here
      // so it survives the user_billing row not yet existing (initNewUserForBusiness
      // also runs inside the same hook). To be safe, ensure-row-then-add via
      // INSERT ... ON CONFLICT.
      await tx.execute(sql`
        INSERT INTO user_billing (user_id, token_balance)
        VALUES (${args.newUserId}, ${REFERRAL_WELCOME_CREDITS})
        ON CONFLICT (user_id) DO UPDATE
        SET token_balance = user_billing.token_balance + ${REFERRAL_WELCOME_CREDITS},
            updated_at = now()
      `);
    });

    console.info(
      `[referrals] signup processed: new_user=${args.newUserId} referrer=${referrer.id} l2=${referrer.referredByL1 ?? 'none'} welcome=${REFERRAL_WELCOME_CREDITS}cr`,
    );
  } catch (error) {
    // Never let referral logic break signup. Log + swallow.
    console.error('[referrals] processReferralSignup error:', error);
  }
}
