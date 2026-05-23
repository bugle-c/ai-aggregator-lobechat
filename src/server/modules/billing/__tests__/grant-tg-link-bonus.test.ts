// @vitest-environment node
/**
 * Real-DB integration test for grantTgLinkBonus.
 *
 * Runs in Node environment so server-side env vars are accessible.
 * Requires lobe-postgres container on 127.0.0.1:5433.
 *
 * Run:
 *   DATABASE_TEST_URL="postgresql://postgres:<pass>@127.0.0.1:5433/lobechat" \
 *   KEY_VAULTS_SECRET=test \
 *   npx vitest run src/server/modules/billing/__tests__/grant-tg-link-bonus.test.ts
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { grantTgLinkBonus } from '../grant-tg-link-bonus';

const { userBilling, users } = schema;

// Unique-per-run user IDs so concurrent test invocations don't clash.
const TEST_USER = 'test-tg-bonus-' + Date.now();
const TEST_USER_2 = 'test-tg-bonus-2-' + Date.now();

let db: LobeChatDatabase;
let pool: Pool;

async function cleanup(userId: string) {
  await db.delete(userBilling).where(eq(userBilling.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

async function ensureUser(userId: string) {
  await cleanup(userId);
  await db.insert(users).values({
    id: userId,
    email: userId + '@test.local',
    emailVerified: false,
  });
}

// Test requires DATABASE_TEST_URL or POSTGRES_PASSWORD to connect to
// the local lobe-postgres. When neither is set we skip — the contract
// is also covered by the production smoke in T12.
const TEST_DB_URL =
  process.env.DATABASE_TEST_URL ||
  (process.env.POSTGRES_PASSWORD
    ? `postgresql://postgres:${process.env.POSTGRES_PASSWORD}@127.0.0.1:5433/lobechat`
    : undefined);

const describeIfDb = TEST_DB_URL ? describe : describe.skip;

describeIfDb('grantTgLinkBonus (real DB)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL! });
    // Cast: node-postgres drizzle instance satisfies LobeChatDatabase for our usage
    db = drizzle(pool, { schema }) as unknown as LobeChatDatabase;

    await ensureUser(TEST_USER);
    await ensureUser(TEST_USER_2);
  });

  afterAll(async () => {
    await cleanup(TEST_USER);
    await cleanup(TEST_USER_2);
    await pool.end();
  });

  beforeEach(async () => {
    // Reset user_billing rows between tests
    await db.delete(userBilling).where(eq(userBilling.userId, TEST_USER));
    await db.delete(userBilling).where(eq(userBilling.userId, TEST_USER_2));
  });

  it('grants 100 credits on first call (insert path — no existing user_billing row)', async () => {
    const r = await grantTgLinkBonus(db, TEST_USER);
    expect(r.granted).toBe(100);
    expect(r.alreadyClaimed).toBe(false);
    expect(r.expiresAt).toBeDefined();

    const [row] = await db.select().from(userBilling).where(eq(userBilling.userId, TEST_USER));
    expect(row.bonusBalance).toBe(100);
    expect(row.tgBonusClaimedAt).not.toBeNull();
    expect(row.bonusBalanceExpiresAt).not.toBeNull();

    const days = (new Date(row.bonusBalanceExpiresAt!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });

  it('is idempotent — second call is no-op', async () => {
    await grantTgLinkBonus(db, TEST_USER);
    const r2 = await grantTgLinkBonus(db, TEST_USER);
    expect(r2.granted).toBe(0);
    expect(r2.alreadyClaimed).toBe(true);

    const [row] = await db.select().from(userBilling).where(eq(userBilling.userId, TEST_USER));
    expect(row.bonusBalance).toBe(100); // not 200
  });

  it('upgrade path — existing user_billing row without stamp gets credited', async () => {
    // Seed: row exists with tokenBalance but no bonus claim yet
    await db.insert(userBilling).values({
      userId: TEST_USER_2,
      tokenBalance: 50,
      planId: 1,
    });
    const r = await grantTgLinkBonus(db, TEST_USER_2);
    expect(r.granted).toBe(100);
    expect(r.alreadyClaimed).toBe(false);

    const [row] = await db.select().from(userBilling).where(eq(userBilling.userId, TEST_USER_2));
    expect(row.bonusBalance).toBe(100);
    expect(row.tokenBalance).toBe(50); // untouched
    expect(row.tgBonusClaimedAt).not.toBeNull();
  });
});
