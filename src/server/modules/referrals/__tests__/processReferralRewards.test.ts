// @vitest-environment node
/**
 * Real-DB integration test for processReferralRewards.
 *
 * Runs in Node environment so server-side env vars are accessible.
 * Requires lobe-postgres container on 127.0.0.1:5433.
 *
 * Run:
 *   DATABASE_TEST_URL="postgresql://postgres:<pass>@127.0.0.1:5433/lobechat" \
 *   KEY_VAULTS_SECRET=test \
 *   npx vitest run src/server/modules/referrals/__tests__/processReferralRewards.test.ts
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import {
  L1_REFEREE_CREDITS,
  L1_REFERRER_CREDITS,
  L2_REFERRER_CREDITS,
  processReferralRewards,
} from '../processReferralRewards';

// Test requires DATABASE_TEST_URL or POSTGRES_PASSWORD to connect to
// the local lobe-postgres. When neither is set we skip — the contract
// is covered by production smoke (T9) anyway.
const TEST_DB_URL =
  process.env.DATABASE_TEST_URL ||
  (process.env.POSTGRES_PASSWORD
    ? `postgresql://postgres:${process.env.POSTGRES_PASSWORD}@127.0.0.1:5433/lobechat`
    : undefined);

const describeIfDb = TEST_DB_URL ? describe : describe.skip;

const NS = 'test-refrwd-' + Date.now();
const REFERRER = `${NS}-referrer`;
const L2_REFERRER = `${NS}-l2`;
const REFEREE = `${NS}-referee`;

describeIfDb('processReferralRewards (real DB)', () => {
  let pool: Pool;
  let db: LobeChatDatabase;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL! });
    db = drizzle(pool, { schema }) as unknown as LobeChatDatabase;
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  beforeEach(async () => {
    await cleanup();
  });

  async function seedUser(id: string, referredByL1?: string) {
    await db.insert(schema.users).values({
      id,
      email: id + '@test.local',
      emailVerified: false,
      referredByL1: referredByL1 ?? null,
    });
  }

  async function cleanup() {
    for (const uid of [REFEREE, REFERRER, L2_REFERRER]) {
      await db.delete(schema.referrals).where(eq(schema.referrals.referredUserId, uid));
      await db.delete(schema.referrals).where(eq(schema.referrals.referrerUserId, uid));
      await db.delete(schema.userBilling).where(eq(schema.userBilling.userId, uid));
      await db.delete(schema.users).where(eq(schema.users.id, uid));
    }
  }

  it('L1 only: rewards referrer + referee, flips status', async () => {
    await seedUser(REFERRER);
    await seedUser(REFEREE, REFERRER);
    await db.insert(schema.referrals).values({
      referrerUserId: REFERRER,
      referredUserId: REFEREE,
      level: 1,
      status: 'pending',
    });

    const result = await processReferralRewards(db, REFEREE);
    expect(result.awardedCount).toBe(1);
    expect(result.totalCredits).toBe(L1_REFERRER_CREDITS + L1_REFEREE_CREDITS);

    const [refRow] = await db
      .select()
      .from(schema.referrals)
      .where(eq(schema.referrals.referredUserId, REFEREE));
    expect(refRow.status).toBe('rewarded');
    expect(refRow.creditsAwarded).toBe(L1_REFERRER_CREDITS);
    expect(refRow.rewardedAt).not.toBeNull();

    const [referrerBilling] = await db
      .select()
      .from(schema.userBilling)
      .where(eq(schema.userBilling.userId, REFERRER));
    expect(referrerBilling.bonusBalance).toBe(L1_REFERRER_CREDITS);
    expect(referrerBilling.bonusBalanceExpiresAt).not.toBeNull();
    const refDays =
      (new Date(referrerBilling.bonusBalanceExpiresAt!).getTime() - Date.now()) / 86_400_000;
    expect(refDays).toBeGreaterThan(29);
    expect(refDays).toBeLessThan(31);

    const [refereeBilling] = await db
      .select()
      .from(schema.userBilling)
      .where(eq(schema.userBilling.userId, REFEREE));
    expect(refereeBilling.bonusBalance).toBe(L1_REFEREE_CREDITS);
  });

  it('L1 + L2: rewards both levels in one pass', async () => {
    await seedUser(L2_REFERRER);
    await seedUser(REFERRER, L2_REFERRER);
    await seedUser(REFEREE, REFERRER);
    await db.insert(schema.referrals).values([
      { referrerUserId: REFERRER, referredUserId: REFEREE, level: 1, status: 'pending' },
      { referrerUserId: L2_REFERRER, referredUserId: REFEREE, level: 2, status: 'pending' },
    ]);

    const result = await processReferralRewards(db, REFEREE);
    expect(result.awardedCount).toBe(2);
    expect(result.totalCredits).toBe(
      L1_REFERRER_CREDITS + L1_REFEREE_CREDITS + L2_REFERRER_CREDITS,
    );

    const [l2Billing] = await db
      .select()
      .from(schema.userBilling)
      .where(eq(schema.userBilling.userId, L2_REFERRER));
    expect(l2Billing.bonusBalance).toBe(L2_REFERRER_CREDITS);

    const l2Ref = await db
      .select()
      .from(schema.referrals)
      .where(eq(schema.referrals.referrerUserId, L2_REFERRER));
    expect(l2Ref[0].status).toBe('rewarded');
    expect(l2Ref[0].creditsAwarded).toBe(L2_REFERRER_CREDITS);
  });

  it('idempotent: second call does nothing', async () => {
    await seedUser(REFERRER);
    await seedUser(REFEREE, REFERRER);
    await db.insert(schema.referrals).values({
      referrerUserId: REFERRER,
      referredUserId: REFEREE,
      level: 1,
      status: 'pending',
    });

    await processReferralRewards(db, REFEREE);
    const second = await processReferralRewards(db, REFEREE);
    expect(second.awardedCount).toBe(0);
    expect(second.totalCredits).toBe(0);

    const [referrerBilling] = await db
      .select()
      .from(schema.userBilling)
      .where(eq(schema.userBilling.userId, REFERRER));
    expect(referrerBilling.bonusBalance).toBe(L1_REFERRER_CREDITS); // not doubled
  });

  it('no pending referrals: no-op', async () => {
    await seedUser(REFEREE);
    const result = await processReferralRewards(db, REFEREE);
    expect(result.awardedCount).toBe(0);
    expect(result.totalCredits).toBe(0);
  });
});
