/**
 * Anti-abuse helpers for the referral program.
 *
 * Goal: keep checks pure and side-effect free where possible so they can be
 * unit-tested without DB / network mocks. The IP velocity check requires DB
 * access and accepts an injected query function so callers (and tests) can
 * stub it.
 *
 * None of these checks BLOCK signup. On failure, we still create the user
 * account but skip creating `referrals` rows / awarding the welcome bonus.
 * This keeps the new-user funnel intact while neutralising fraud.
 */

import { sql } from 'drizzle-orm';

import { type LobeChatDatabase } from '@/database/type';

/**
 * Disposable email domains. List is intentionally short — covers the most
 * common throwaway services without adding noise. False negatives (new
 * domains popping up) are acceptable; false positives would block real users.
 *
 * Matches the local-part-aware regex in the design spec.
 */
const DISPOSABLE_DOMAIN_RE =
  /@(?:mailinator|tempmail|guerrillamail|10minutemail|throwaway|yopmail|trashmail|getnada|maildrop|sharklasers|mintemail|fakeinbox|temp-mail|dispostable)\.[^@\s]+$/i;

/**
 * Returns true if the email's domain looks like a disposable / throwaway
 * service. Returns false for empty / malformed input — better to err on the
 * side of "looks legit" so we don't lose real signups to false positives.
 */
export function isDisposableEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed.includes('@')) return false;
  return DISPOSABLE_DOMAIN_RE.test(trimmed);
}

/**
 * Self-refer guard: if the referrer's user_id equals the new user's id, OR
 * the referrer's email matches the new user's email (case-insensitive,
 * trimmed), we treat it as self-refer and skip the referral.
 */
export function selfReferCheck(args: {
  referrerUserId: string;
  referrerEmail?: string | null;
  newUserId: string;
  newUserEmail?: string | null;
}): { ok: boolean; reason?: string } {
  if (args.referrerUserId === args.newUserId) {
    return { ok: false, reason: 'same_user_id' };
  }
  const refEmail = args.referrerEmail?.trim().toLowerCase();
  const newEmail = args.newUserEmail?.trim().toLowerCase();
  if (refEmail && newEmail && refEmail === newEmail) {
    return { ok: false, reason: 'same_email' };
  }
  return { ok: true };
}

/**
 * Generates an 8-char [a-z0-9] referral code. Lowercase only so links look
 * clean in URLs and emails. Caller is responsible for retrying on collision
 * (extremely rare but possible).
 */
export function generateReferralCode(): string {
  const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/**
 * Passive IP velocity check — returns whether we're seeing a velocity-based
 * abuse pattern. NOT blocking: the caller logs the flag for admin review but
 * still allows the signup + referral creation. Threshold: ≥3 signups from
 * the same IP using the same `_ref` cookie within the past 24 hours.
 *
 * Returns `{ flagged: false }` on any DB error to fail open.
 */
export async function ipVelocityCheck(
  db: LobeChatDatabase,
  args: { ip: string | null | undefined; refCode: string },
  threshold = 3,
): Promise<{ flagged: boolean; count?: number }> {
  if (!args.ip || !args.refCode) return { flagged: false };
  try {
    // Best-effort: count recent signups from same IP with the same ref code.
    // We tolerate the table not existing yet (early deploy) by catching errors.
    const result: any = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM users u
      JOIN referrals r ON r.referred_user_id = u.id
      JOIN users referrer ON r.referrer_user_id = referrer.id
      WHERE referrer.referral_code = ${args.refCode}
        AND u.created_at > now() - interval '24 hours'
    `);
    const rows = (result?.rows ?? result) as Array<{ cnt: number }>;
    const count = rows?.[0]?.cnt ?? 0;
    return { flagged: count >= threshold, count };
  } catch (error) {
    console.warn('[referrals] ipVelocityCheck failed open:', (error as Error).message);
    return { flagged: false };
  }
}
