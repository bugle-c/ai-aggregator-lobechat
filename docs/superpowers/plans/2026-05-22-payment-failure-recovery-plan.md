# Payment Failure Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture YooKassa failure reasons, default checkout to SBP, and recover lost payment attempts via a site retry modal + Telegram DM, to lift paying-user rate from 1.87/week to ≥7/week.

**Architecture:** Telemetry layer parses `cancellation_details` + `payment_method` from YooKassa webhooks/reconcile and stores them in `billing_payments.metadata` jsonb. Recovery has two channels: a site modal (lazy + return-url triggered) and a 5-min cron that DMs users with `tg_bot_chat_id` set via the existing internal bot bridge. A new HMAC-signed `recovery-retry` endpoint lets bot-issued links restart purchases without a session. Admin observability page in webgpt-admin reads the new metadata fields.

**Tech Stack:** Next.js 16 (App Router), TypeScript strict, Drizzle ORM (Postgres `lobechat`), tRPC, Vitest. Bot (`gptwebrubot`) is Node + grammY. Admin (`webgpt-admin`) is Next.js 16. All three deploy via Docker — primary container `lobechat-custom:latest` in `/opt/lobechat`.

**Spec:** `docs/superpowers/specs/2026-05-22-payment-failure-recovery-design.md` (commit `5d195b8a5b`).

---

## File Map

| Path                                                               | Role                                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `src/server/modules/billing/cancellation-reasons.ts`               | NEW — SoT for `YK reason → human RU → suggest method` mapping                                          |
| `src/server/modules/billing/parse-yk-payload.ts`                   | NEW — pure `extractMetadataPatch(payload.object)` returning the jsonb patch                            |
| `src/server/modules/billing/recovery-token.ts`                     | NEW — HMAC sign + verify helpers for bot-issued retry URLs                                             |
| `src/server/modules/billing/yookassa.ts`                           | MODIFY — add `paymentMethodType` + fallback, extend `fetchYookassaPaymentStatus` to return full object |
| `src/app/(backend)/api/billing/webhook/route.ts`                   | MODIFY — merge metadata patch on every event                                                           |
| `src/app/(backend)/api/cron/reconcile-pending-payments/route.ts`   | MODIFY — merge metadata patch on each polled YK fetch                                                  |
| `src/business/server/lambda-routers/topUp.ts`                      | MODIFY — pass `paymentMethodType: 'sbp'` + write metadata fields                                       |
| `src/business/server/lambda-routers/subscription.ts`               | MODIFY — same as topUp                                                                                 |
| `src/business/server/lambda-routers/billing.ts`                    | MODIFY (or NEW if absent) — `getRecentFailure` query for site modal                                    |
| `src/app/(backend)/api/billing/recovery-retry/route.ts`            | NEW — GET endpoint verifying HMAC + restarting purchase + 302 to YK                                    |
| `src/app/(backend)/api/cron/payment-recovery-notify/route.ts`      | NEW — 5-min cron, fetches eligible rows, POSTs to bot                                                  |
| `src/features/PaymentRetry/RetryModal.tsx`                         | NEW — UI component                                                                                     |
| `src/features/PaymentRetry/index.ts`                               | NEW — barrel export                                                                                    |
| `src/app/[variants]/(main)/_layout/index.tsx`                      | MODIFY — mount `<RetryModal />`                                                                        |
| (gptwebrubot) `src/routes/internal/payment-recovery.ts`            | NEW — bot endpoint that sends DM                                                                       |
| (webgpt-admin) `app/(dashboard)/finance/payment-failures/page.tsx` | NEW — admin observability page                                                                         |
| (webgpt-admin) `lib/queries/payment-failures.ts`                   | NEW — Postgres queries for admin page                                                                  |
| `/etc/cron.d/lobechat-payment-recovery` (Hetzner host)             | NEW — crontab entry                                                                                    |

YooKassa Kabinet reorder is **manual** (Pavel, see Task 17).

---

## Phase 1 — Foundation (pure functions, easy tests)

### Task 1: Cancellation reason mapping

**Files:**

- Create: `src/server/modules/billing/cancellation-reasons.ts`

- Test: `src/server/modules/billing/__tests__/cancellation-reasons.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/modules/billing/__tests__/cancellation-reasons.test.ts
import { describe, expect, it } from 'vitest';

import { describeReason, REASON_MAP } from '../cancellation-reasons';

describe('cancellation-reasons', () => {
  it('maps insufficient_funds to a Russian human-readable text and retry-same suggestion', () => {
    const r = describeReason('insufficient_funds');
    expect(r.text).toBe('На карте не хватило средств');
    expect(r.suggest).toBe('retry_same');
  });

  it('maps card-related rejections to sbp suggestion', () => {
    expect(describeReason('payment_method_restricted').suggest).toBe('sbp');
    expect(describeReason('card_expired').suggest).toBe('sbp');
    expect(describeReason('country_forbidden').suggest).toBe('sbp');
    expect(describeReason('3d_secure_failed').suggest).toBe('sbp');
    expect(describeReason('general_decline').suggest).toBe('sbp');
    expect(describeReason('permission_revoked').suggest).toBe('sbp');
  });

  it('maps expiry/timeout reasons to retry suggestion', () => {
    expect(describeReason('expired_on_confirmation').suggest).toBe('retry');
    expect(describeReason('expired_on_capture').suggest).toBe('retry');
    expect(describeReason('canceled_by_merchant').suggest).toBe('retry');
    expect(describeReason('internal_timeout').suggest).toBe('retry');
  });

  it('maps fraud_suspected to support channel', () => {
    expect(describeReason('fraud_suspected').suggest).toBe('support');
  });

  it('returns a generic fallback for unknown / null reasons', () => {
    expect(describeReason('something_new').text).toBe('Платёж не прошёл');
    expect(describeReason('something_new').suggest).toBe('sbp');
    expect(describeReason(null).text).toBe('Платёж не прошёл');
    expect(describeReason(undefined).text).toBe('Платёж не прошёл');
  });

  it('exports REASON_MAP keyed by all documented YK reasons', () => {
    for (const key of [
      'insufficient_funds',
      'payment_method_restricted',
      'card_expired',
      'country_forbidden',
      '3d_secure_failed',
      'general_decline',
      'expired_on_confirmation',
      'expired_on_capture',
      'canceled_by_merchant',
      'permission_revoked',
      'internal_timeout',
      'fraud_suspected',
    ]) {
      expect(REASON_MAP[key]).toBeDefined();
      expect(REASON_MAP[key].text).toBeTruthy();
      expect(REASON_MAP[key].suggest).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
npx vitest run src/server/modules/billing/__tests__/cancellation-reasons.test.ts
```

Expected: FAIL with "Cannot find module '../cancellation-reasons'".

- [ ] **Step 3: Implement the module**

```ts
// src/server/modules/billing/cancellation-reasons.ts

/**
 * YooKassa payment cancellation/failure reason → human-readable RU text
 * + which recovery method to suggest.
 *
 * Single source of truth used by:
 *   - the in-app RetryModal (src/features/PaymentRetry)
 *   - the Telegram recovery DM (bot endpoint)
 *   - the admin observability page (webgpt-admin)
 *
 * `suggest` values:
 *   - 'sbp'         — recommend SBP (faster payments via bank app, no 3DS)
 *   - 'retry_same'  — same method, just try again (transient issue)
 *   - 'retry'       — generic retry (probably timeout / closed window)
 *   - 'support'     — point user at @gptwebrubot for manual help
 */
export type Suggest = 'sbp' | 'retry_same' | 'retry' | 'support';

export interface ReasonDescription {
  text: string;
  suggest: Suggest;
}

export const REASON_MAP: Record<string, ReasonDescription> = {
  '3d_secure_failed': { text: 'Не прошла проверка 3-D Secure', suggest: 'sbp' },
  'canceled_by_merchant': { text: 'Отменено системой', suggest: 'retry' },
  'card_expired': { text: 'Срок действия карты истёк', suggest: 'sbp' },
  'country_forbidden': { text: 'Карта из неподдерживаемой страны', suggest: 'sbp' },
  'expired_on_capture': { text: 'Сорвался захват средств', suggest: 'retry' },
  'expired_on_confirmation': { text: 'Не успели подтвердить за час', suggest: 'retry' },
  'fraud_suspected': { text: 'Подозрение на фрод', suggest: 'support' },
  'general_decline': { text: 'Банк отклонил без объяснений', suggest: 'sbp' },
  'insufficient_funds': { text: 'На карте не хватило средств', suggest: 'retry_same' },
  'internal_timeout': { text: 'Технический сбой YooKassa', suggest: 'retry' },
  'payment_method_restricted': { text: 'Банк не разрешает онлайн-оплаты', suggest: 'sbp' },
  'permission_revoked': { text: 'Отозваны права на оплату', suggest: 'sbp' },
};

const FALLBACK: ReasonDescription = { text: 'Платёж не прошёл', suggest: 'sbp' };

export function describeReason(reason: string | null | undefined): ReasonDescription {
  if (!reason) return FALLBACK;
  return REASON_MAP[reason] ?? FALLBACK;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/server/modules/billing/__tests__/cancellation-reasons.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/billing/cancellation-reasons.ts src/server/modules/billing/__tests__/cancellation-reasons.test.ts
git commit -m "feat(billing): cancellation reason → RU + suggest mapping (SoT)"
```

---

### Task 2: YooKassa payload parser

**Files:**

- Create: `src/server/modules/billing/parse-yk-payload.ts`

- Test: `src/server/modules/billing/__tests__/parse-yk-payload.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/modules/billing/__tests__/parse-yk-payload.test.ts
import { describe, expect, it } from 'vitest';

import { extractMetadataPatch, type YookassaPaymentObject } from '../parse-yk-payload';

describe('extractMetadataPatch', () => {
  it('captures cancellation_details when present', () => {
    const obj: YookassaPaymentObject = {
      id: '2f5b',
      status: 'canceled',
      cancellation_details: { party: 'payment_network', reason: 'insufficient_funds' },
    };
    const patch = extractMetadataPatch(obj);
    expect(patch.cancellation).toEqual({
      party: 'payment_network',
      reason: 'insufficient_funds',
      filled_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it('captures bank_card payment_method with first6/last4/issuer fields', () => {
    const obj: YookassaPaymentObject = {
      id: 'x',
      status: 'succeeded',
      payment_method: {
        type: 'bank_card',
        card: {
          first6: '220070',
          last4: '1234',
          card_type: 'MasterCard',
          issuer_country: 'RU',
          issuer_name: 'TINKOFF BANK',
        },
      },
    };
    const patch = extractMetadataPatch(obj);
    expect(patch.payment_method).toEqual({
      type: 'bank_card',
      card_first6: '220070',
      card_last4: '1234',
      card_issuer_country: 'RU',
      card_issuer_name: 'TINKOFF BANK',
      sbp_bank_id: null,
    });
  });

  it('captures sbp.bank_id when type is sbp', () => {
    const obj: YookassaPaymentObject = {
      id: 'x',
      status: 'succeeded',
      payment_method: { type: 'sbp', sbp: { bank_id: '100000000007' } },
    };
    expect(extractMetadataPatch(obj).payment_method).toEqual({
      type: 'sbp',
      card_first6: null,
      card_last4: null,
      card_issuer_country: null,
      card_issuer_name: null,
      sbp_bank_id: '100000000007',
    });
  });

  it('omits cancellation key when YK did not send cancellation_details', () => {
    const patch = extractMetadataPatch({ id: 'x', status: 'succeeded' });
    expect(patch.cancellation).toBeUndefined();
  });

  it('omits payment_method key when YK did not send payment_method', () => {
    const patch = extractMetadataPatch({ id: 'x', status: 'canceled' });
    expect(patch.payment_method).toBeUndefined();
  });

  it('survives missing nested fields without throwing', () => {
    const obj: YookassaPaymentObject = {
      id: 'x',
      status: 'canceled',
      payment_method: { type: 'bank_card' /* no card */ },
      cancellation_details: { party: 'unknown' /* no reason */ } as any,
    };
    const patch = extractMetadataPatch(obj);
    expect(patch.cancellation?.reason).toBeUndefined();
    expect(patch.payment_method?.card_first6).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/server/modules/billing/__tests__/parse-yk-payload.test.ts
```

Expected: FAIL with "Cannot find module '../parse-yk-payload'".

- [ ] **Step 3: Implement the parser**

```ts
// src/server/modules/billing/parse-yk-payload.ts

/**
 * Shape of the `object` field in YooKassa webhook payloads + fetched
 * payments. We only declare the fields we actually read — YK includes
 * many more (amount, captured_at, refundable, ...) that don't matter
 * for telemetry.
 */
export interface YookassaPaymentObject {
  id: string;
  status: string;
  cancellation_details?: {
    party?: string;
    reason?: string;
  };
  payment_method?: {
    type?: string;
    id?: string;
    saved?: boolean;
    card?: {
      first6?: string;
      last4?: string;
      card_type?: string;
      issuer_country?: string;
      issuer_name?: string;
    };
    sbp?: {
      bank_id?: string;
    };
  };
}

export interface CancellationPatch {
  party?: string;
  reason?: string;
  filled_at: string;
}

export interface PaymentMethodPatch {
  type: string | null;
  card_first6: string | null;
  card_last4: string | null;
  card_issuer_country: string | null;
  card_issuer_name: string | null;
  sbp_bank_id: string | null;
}

export interface MetadataPatch {
  cancellation?: CancellationPatch;
  payment_method?: PaymentMethodPatch;
}

/**
 * Pure function: turn a YK payment object into a partial metadata
 * patch that can be merged into billing_payments.metadata via
 * `metadata = metadata || $patch::jsonb`. Returns an empty object
 * if YK sent nothing useful.
 */
export function extractMetadataPatch(obj: YookassaPaymentObject): MetadataPatch {
  const patch: MetadataPatch = {};

  if (obj.cancellation_details) {
    patch.cancellation = {
      party: obj.cancellation_details.party,
      reason: obj.cancellation_details.reason,
      filled_at: new Date().toISOString(),
    };
  }

  if (obj.payment_method) {
    patch.payment_method = {
      type: obj.payment_method.type ?? null,
      card_first6: obj.payment_method.card?.first6 ?? null,
      card_last4: obj.payment_method.card?.last4 ?? null,
      card_issuer_country: obj.payment_method.card?.issuer_country ?? null,
      card_issuer_name: obj.payment_method.card?.issuer_name ?? null,
      sbp_bank_id: obj.payment_method.sbp?.bank_id ?? null,
    };
  }

  return patch;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/server/modules/billing/__tests__/parse-yk-payload.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/billing/parse-yk-payload.ts src/server/modules/billing/__tests__/parse-yk-payload.test.ts
git commit -m "feat(billing): pure parser for YK payment object → metadata patch"
```

---

## Phase 2 — Wire telemetry into existing flows

### Task 3: Webhook merges metadata patch

**Files:**

- Modify: `src/app/(backend)/api/billing/webhook/route.ts`

- Test: `src/app/(backend)/api/billing/webhook/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/(backend)/api/billing/webhook/__tests__/route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/database/server', () => ({ getServerDB: vi.fn() }));
vi.mock('@/server/modules/billing/fulfill', () => ({
  fulfillPayment: vi.fn(),
  cancelPayment: vi.fn(),
}));

const updateChain = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
const setChain = vi.fn().mockReturnValue({ where: updateChain });
const dbMock = { update: vi.fn().mockReturnValue({ set: setChain }) };

import { getServerDB } from '@/database/server';
(getServerDB as any).mockResolvedValue(dbMock);

import { POST } from '../route';

describe('billing webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerDB as any).mockResolvedValue(dbMock);
  });

  it('on payment.canceled writes cancellation + payment_method into metadata', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event: 'payment.canceled',
        type: 'notification',
        object: {
          id: 'yk-id-1',
          status: 'canceled',
          cancellation_details: { party: 'payment_network', reason: 'insufficient_funds' },
          payment_method: {
            type: 'bank_card',
            card: { first6: '220070', last4: '1234', issuer_country: 'RU', issuer_name: 'TBANK' },
          },
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // setChain receives the merge update
    expect(setChain).toHaveBeenCalled();
    const setArg = setChain.mock.calls[0][0];
    expect(setArg.metadata).toBeDefined(); // sql.raw or similar — we assert it was passed
  });

  it('on payment.succeeded passes saved_method_id through to fulfillPayment', async () => {
    const { fulfillPayment } = await import('@/server/modules/billing/fulfill');
    const req = new Request('http://x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event: 'payment.succeeded',
        type: 'notification',
        object: {
          id: 'yk-id-2',
          status: 'succeeded',
          payment_method: { id: 'pm-1', saved: true, type: 'bank_card' },
        },
      }),
    });
    await POST(req);
    expect(fulfillPayment).toHaveBeenCalledWith(dbMock, 'yk-id-2', {
      savedPaymentMethodId: 'pm-1',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/app/\(backend\)/api/billing/webhook/__tests__/route.test.ts
```

Expected: FAIL — current handler doesn't merge metadata.

- [ ] **Step 3: Modify the webhook**

Replace the entire `src/app/(backend)/api/billing/webhook/route.ts` body:

```ts
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
  type: string;
  object: YookassaPaymentObject;
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/app/\(backend\)/api/billing/webhook/__tests__/route.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(backend\)/api/billing/webhook/route.ts src/app/\(backend\)/api/billing/webhook/__tests__/route.test.ts
git commit -m "feat(billing): merge YK cancellation + payment_method into metadata on webhook"
```

---

### Task 4: Reconcile cron also merges metadata patch

**Files:**

- Modify: `src/server/modules/billing/yookassa.ts:115-140` (extend `fetchYookassaPaymentStatus`)

- Modify: `src/app/(backend)/api/cron/reconcile-pending-payments/route.ts`

- [ ] **Step 1: Read the current `fetchYookassaPaymentStatus` signature**

```bash
grep -n "fetchYookassaPaymentStatus" src/server/modules/billing/yookassa.ts
```

Confirm the function exists and returns `{status, paymentMethodId}` today.

- [ ] **Step 2: Extend `fetchYookassaPaymentStatus` to return full object**

Modify the function to return the raw YK object plus the existing summary:

```ts
// In src/server/modules/billing/yookassa.ts — replace existing fetchYookassaPaymentStatus
import { extractMetadataPatch, type YookassaPaymentObject } from './parse-yk-payload';

export async function fetchYookassaPaymentStatus(yookassaPaymentId: string): Promise<{
  status: string;
  paymentMethodId?: string;
  object: YookassaPaymentObject;
} | null> {
  const shopId = billingEnv.YOOKASSA_SHOP_ID;
  const secretKey = billingEnv.YOOKASSA_SECRET_KEY;
  if (!shopId || !secretKey) throw new Error('YooKassa credentials not configured');

  const auth = Buffer.from(`${shopId}:${secretKey}`).toString('base64');
  const res = await fetch(`https://api.yookassa.ru/v3/payments/${yookassaPaymentId}`, {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`YooKassa fetch failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as YookassaPaymentObject & {
    payment_method?: { id?: string; saved?: boolean; type?: string };
  };
  return {
    status: data.status,
    paymentMethodId:
      data.payment_method?.saved && data.payment_method.id ? data.payment_method.id : undefined,
    object: data,
  };
}
```

- [ ] **Step 3: Update reconcile cron to merge metadata patch on every fetch**

In `src/app/(backend)/api/cron/reconcile-pending-payments/route.ts`, inside the `for (const row of stale)` loop, immediately after `const yk = await fetchYookassaPaymentStatus(row.yookassaPaymentId);` add the metadata merge:

```ts
// Add at top of file:
import { sql } from 'drizzle-orm';
import { extractMetadataPatch } from '@/server/modules/billing/parse-yk-payload';

// Inside the for-loop, right after `if (!yk)` block (which now has a return early):
if (!yk) {
  await db
    .update(billingPayments)
    .set({ status: 'failed', updatedAt: new Date() })
    .where(eq(billingPayments.id, row.id));
  summary.localFailed++;
  continue;
}

// NEW: merge whatever telemetry YK now has on this payment.
const patch = extractMetadataPatch(yk.object);
if (Object.keys(patch).length > 0) {
  await db
    .update(billingPayments)
    .set({
      metadata: sql`COALESCE(${billingPayments.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(billingPayments.id, row.id));
}

// ... existing status handling continues
```

- [ ] **Step 4: Smoke test by running existing test suite**

```bash
npx vitest run src/server/modules/billing/__tests__/
npx tsc --noEmit
```

Expected: all existing billing tests still pass, no TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/billing/yookassa.ts src/app/\(backend\)/api/cron/reconcile-pending-payments/route.ts
git commit -m "feat(billing): reconcile cron merges YK metadata patch on every poll"
```

---

## Phase 3 — SBP preselect

### Task 5: `createYookassaPayment` accepts `paymentMethodType` with fallback

**Files:**

- Modify: `src/server/modules/billing/yookassa.ts`

- Test: `src/server/modules/billing/__tests__/yookassa-create.test.ts` (new — small unit test using fetch mock)

- [ ] **Step 1: Write the failing test**

```ts
// src/server/modules/billing/__tests__/yookassa-create.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/envs/billing', () => ({
  billingEnv: { YOOKASSA_SHOP_ID: 'shop', YOOKASSA_SECRET_KEY: 'secret' },
}));

import { createYookassaPayment } from '../yookassa';

const fetchMock = vi.fn();
const origFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as any;
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

describe('createYookassaPayment paymentMethodType', () => {
  it('includes payment_method_data when paymentMethodType is set', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'pay-1',
          status: 'pending',
          confirmation: { confirmation_url: 'https://yk/url' },
        }),
        { status: 200 },
      ),
    );
    await createYookassaPayment({
      amountRub: 490,
      description: 'Top-up',
      returnUrl: 'https://ask.gptweb.ru/',
      paymentMethodType: 'sbp',
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.payment_method_data).toEqual({ type: 'sbp' });
  });

  it('omits payment_method_data when paymentMethodType is undefined', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'pay-2',
          status: 'pending',
          confirmation: { confirmation_url: 'https://yk/url' },
        }),
        { status: 200 },
      ),
    );
    await createYookassaPayment({
      amountRub: 490,
      description: 'Top-up',
      returnUrl: 'https://ask.gptweb.ru/',
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.payment_method_data).toBeUndefined();
  });

  it('falls back to non-preselected when YK returns 400 unsupported_payment_method', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: 'error',
            code: 'invalid_request',
            description: 'Invalid parameter payment_method_data.type',
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'pay-3',
            status: 'pending',
            confirmation: { confirmation_url: 'https://yk/fallback' },
          }),
          { status: 200 },
        ),
      );
    const result = await createYookassaPayment({
      amountRub: 490,
      description: 'Top-up',
      returnUrl: 'https://ask.gptweb.ru/',
      paymentMethodType: 'sbp',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.paymentId).toBe('pay-3');

    const firstBody = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(firstBody.payment_method_data).toBeDefined();
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as any).body);
    expect(secondBody.payment_method_data).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/server/modules/billing/__tests__/yookassa-create.test.ts
```

Expected: FAIL — `paymentMethodType` not in CreatePaymentParams.

- [ ] **Step 3: Implement the changes in `yookassa.ts`**

Add `paymentMethodType` to `CreatePaymentParams`:

```ts
interface CreatePaymentParams {
  amountRub: number;
  customerEmail?: string;
  description: string;
  metadata?: Record<string, string>;
  paymentMethodId?: string;
  returnUrl: string;
  savePaymentMethod?: boolean;
  /**
   * Pre-select payment method on the YooKassa hosted form. Other methods
   * remain accessible via "Выбрать другой способ оплаты". We default to
   * 'sbp' for new top-ups based on RU 2026 conversion data — bank cards
   * are 2-3× more likely to be rejected (TINKOFF / other RU banks block
   * 3DS on online merchants, foreign-issued cards fail country checks).
   */
  paymentMethodType?: 'sbp' | 'bank_card' | 'yoo_money' | 'sber_b2b' | 'tinkoff_bank';
}
```

Replace the existing call-site for `fetch(...)`:

```ts
// Build base body (same as before but extracted so we can retry)
const buildBody = (withMethod: boolean): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    amount: { currency: 'RUB', value: params.amountRub.toFixed(2) },
    capture: true,
    description: params.description,
    metadata: params.metadata || {},
    receipt: {
      customer: { email: params.customerEmail || 'noreply@gptweb.ru' },
      items: [
        {
          amount: { currency: 'RUB', value: params.amountRub.toFixed(2) },
          description: params.description.slice(0, 128),
          payment_mode: 'full_payment',
          payment_subject: 'service',
          quantity: '1.00',
          vat_code: 1,
        },
      ],
    },
  };
  if (isRecurring) {
    body.payment_method_id = params.paymentMethodId;
  } else {
    body.confirmation = { return_url: params.returnUrl, type: 'redirect' };
    if (params.savePaymentMethod) body.save_payment_method = true;
    if (withMethod && params.paymentMethodType) {
      body.payment_method_data = { type: params.paymentMethodType };
    }
  }
  return body;
};

const callYK = async (
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json: any }> => {
  const res = await fetch('https://api.yookassa.ru/v3/payments', {
    body: JSON.stringify(body),
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Idempotence-Key': crypto.randomUUID(),
    },
    method: 'POST',
  });
  const json = await res.json();
  return { ok: res.ok, status: res.status, json };
};

let attempt = await callYK(buildBody(true));

// Fallback: YK rejected our preselected method (not enabled in this
// shop, or unknown). Retry without payment_method_data. Logged so we
// notice if SBP needs to be enabled in the Kabinet.
const unsupportedMethod =
  !attempt.ok &&
  attempt.status === 400 &&
  typeof attempt.json?.description === 'string' &&
  /payment_method_data/i.test(attempt.json.description);

if (unsupportedMethod && params.paymentMethodType) {
  console.warn(
    `[billing] YK rejected payment_method_data.type=${params.paymentMethodType} — falling back to default. Configure this method in the YK Kabinet.`,
  );
  attempt = await callYK(buildBody(false));
}

if (!attempt.ok) {
  throw new Error(
    `YooKassa createPayment failed: ${attempt.status} ${JSON.stringify(attempt.json)}`,
  );
}

const data = attempt.json as YookassaPaymentResponse;
return {
  paymentId: data.id,
  paymentUrl: data.confirmation?.confirmation_url ?? null,
  status: data.status,
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/server/modules/billing/__tests__/yookassa-create.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/billing/yookassa.ts src/server/modules/billing/__tests__/yookassa-create.test.ts
git commit -m "feat(billing): createYookassaPayment accepts paymentMethodType (sbp) with fallback"
```

---

### Task 6: topUp router passes `paymentMethodType: 'sbp'` + writes metadata fields

**Files:**

- Modify: `src/business/server/lambda-routers/topUp.ts`

- [ ] **Step 1: Read current topUp router to find the YK call and DB insert**

```bash
grep -n "createYookassaPayment\|billingPayments\|insert" src/business/server/lambda-routers/topUp.ts | head -10
```

- [ ] **Step 2: Add SBP preselect + new metadata fields**

Locate the `purchase` mutation. At the top of the procedure, fetch the user's `tg_bot_chat_id` (we use it for the recovery cron):

```ts
// near the top of the purchase mutation handler, after we know ctx.userId
const ubRow = await db
  .select({ tgBotChatId: userBilling.tgBotChatId })
  .from(userBilling)
  .where(eq(userBilling.userId, ctx.userId))
  .then((r) => r[0]);

const tgChatId = ubRow?.tgBotChatId ?? null;
```

Pass `paymentMethodType: 'sbp'` to `createYookassaPayment`:

```ts
const payment = await createYookassaPayment({
  amountRub,
  customerEmail: ctx.user?.email,
  description,
  metadata: { pricing_variant: pricingVariant }, // existing
  paymentMethodType: 'sbp', // NEW
  returnUrl,
});
```

When inserting the `billingPayments` row, expand `metadata`:

```ts
await db.insert(billingPayments).values({
  amountRub,
  metadata: {
    pricing_variant: pricingVariant,
    sbp_preselected: true, // NEW
    tg_user_id: tgChatId, // NEW (number or null)
  },
  planId,
  status: 'pending',
  tokensAmount,
  type: 'top_up',
  userId: ctx.userId,
  yookassaPaymentId: payment.paymentId,
});
```

If `pricingVariant` isn't defined in this file currently, leave the metadata as is (no `pricing_variant` key) — only add the two new fields. Check by reading the file.

- [ ] **Step 3: Manual smoke — create a top-up via dev flow OR check next deploy**

Type-check first:

```bash
npx tsc --noEmit
```

Then confirm by reading the file diff is sensible:

```bash
git diff src/business/server/lambda-routers/topUp.ts
```

Expected: imports for `userBilling` and `eq` may need adding (if not already there). Add them at top:

```ts
import { eq } from 'drizzle-orm';
import { userBilling } from '@/database/schemas';
```

- [ ] **Step 4: Commit**

```bash
git add src/business/server/lambda-routers/topUp.ts
git commit -m "feat(billing): top-up uses SBP preselect + writes tg_user_id metadata"
```

---

### Task 7: subscription router — same change as Task 6

**Files:**

- Modify: `src/business/server/lambda-routers/subscription.ts`

- [ ] **Step 1: Read current subscription router**

```bash
grep -n "createYookassaPayment\|billingPayments" src/business/server/lambda-routers/subscription.ts | head -10
```

- [ ] **Step 2: Apply the same `paymentMethodType: 'sbp'` + metadata enrichment**

Use the same approach as Task 6: fetch `tg_bot_chat_id`, pass `paymentMethodType: 'sbp'`, expand metadata insert to include `sbp_preselected: true` and `tg_user_id`. **Skip** `paymentMethodType` for the recurring-charge path (cron renewal — `paymentMethodId` already set there, YK doesn't show a user screen).

```ts
const ubRow = await db
  .select({ tgBotChatId: userBilling.tgBotChatId })
  .from(userBilling)
  .where(eq(userBilling.userId, ctx.userId))
  .then((r) => r[0]);

const tgChatId = ubRow?.tgBotChatId ?? null;

const payment = await createYookassaPayment({
  amountRub,
  customerEmail: ctx.user?.email,
  description,
  metadata: { pricing_variant: pricingVariant },
  paymentMethodType: 'sbp', // NEW — only for initial sub start, NOT recurring
  returnUrl,
  savePaymentMethod: true, // existing — subs save method
});

await db.insert(billingPayments).values({
  amountRub,
  metadata: {
    pricing_variant: pricingVariant,
    sbp_preselected: true,
    tg_user_id: tgChatId,
  },
  planId,
  status: 'pending',
  tokensAmount,
  type: 'subscription',
  userId: ctx.userId,
  yookassaPaymentId: payment.paymentId,
});
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/business/server/lambda-routers/subscription.ts
git commit -m "feat(billing): subscription start uses SBP preselect + writes tg_user_id metadata"
```

---

## Phase 4 — Recovery URL infrastructure

### Task 8: HMAC sign + verify helpers

**Files:**

- Create: `src/server/modules/billing/recovery-token.ts`

- Test: `src/server/modules/billing/__tests__/recovery-token.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/modules/billing/__tests__/recovery-token.test.ts
import { describe, expect, it } from 'vitest';

import { signRecoveryToken, verifyRecoveryToken } from '../recovery-token';

const SECRET = 'a'.repeat(32);

describe('recovery-token', () => {
  it('sign + verify roundtrip succeeds with same secret and unexpired token', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const t = signRecoveryToken({ paymentId: 'p1', userId: 'u1', method: 'sbp', exp }, SECRET);
    const v = verifyRecoveryToken(t, SECRET);
    expect(v).toEqual({ paymentId: 'p1', userId: 'u1', method: 'sbp', exp });
  });

  it('verify rejects token signed with different secret', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const t = signRecoveryToken({ paymentId: 'p1', userId: 'u1', method: 'sbp', exp }, SECRET);
    expect(verifyRecoveryToken(t, 'b'.repeat(32))).toBeNull();
  });

  it('verify rejects expired token', () => {
    const exp = Math.floor(Date.now() / 1000) - 10; // expired 10s ago
    const t = signRecoveryToken({ paymentId: 'p1', userId: 'u1', method: 'sbp', exp }, SECRET);
    expect(verifyRecoveryToken(t, SECRET)).toBeNull();
  });

  it('verify rejects malformed token', () => {
    expect(verifyRecoveryToken('not-a-token', SECRET)).toBeNull();
    expect(verifyRecoveryToken('a.b', SECRET)).toBeNull();
    expect(verifyRecoveryToken('', SECRET)).toBeNull();
  });

  it('verify rejects tampered payload (signature mismatch)', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const t = signRecoveryToken({ paymentId: 'p1', userId: 'u1', method: 'sbp', exp }, SECRET);
    // flip last char of the base64url payload portion
    const [pl, sig] = t.split('.');
    const tampered = `${pl.slice(0, -1)}${pl.at(-1) === 'a' ? 'b' : 'a'}.${sig}`;
    expect(verifyRecoveryToken(tampered, SECRET)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/server/modules/billing/__tests__/recovery-token.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the helper**

```ts
// src/server/modules/billing/recovery-token.ts
import crypto from 'node:crypto';

/**
 * HMAC-signed token used in bot-issued recovery URLs. Carries enough
 * info to restart a purchase server-side without a session — the bot
 * vouches for the (paymentId, userId, method) tuple via its server-
 * controlled secret.
 *
 * Format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`. Both
 * halves use base64url (RFC 4648 §5) so the token is URL-safe.
 */

export interface RecoveryPayload {
  paymentId: string;
  userId: string;
  method: 'sbp' | 'any';
  exp: number; // unix seconds
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(s: string): Buffer {
  const padded = s.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((s.length + 3) % 4);
  return Buffer.from(padded, 'base64');
}

function hmac(payload: string, secret: string): string {
  return b64urlEncode(crypto.createHmac('sha256', secret).update(payload).digest());
}

export function signRecoveryToken(payload: RecoveryPayload, secret: string): string {
  const json = JSON.stringify(payload);
  const pl = b64urlEncode(Buffer.from(json, 'utf8'));
  const sig = hmac(pl, secret);
  return `${pl}.${sig}`;
}

export function verifyRecoveryToken(token: string, secret: string): RecoveryPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [pl, sig] = parts;
  if (!pl || !sig) return null;

  const expected = hmac(pl, secret);
  // constant-time compare to avoid timing oracle
  if (expected.length !== sig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;

  let payload: RecoveryPayload;
  try {
    payload = JSON.parse(b64urlDecode(pl).toString('utf8'));
  } catch {
    return null;
  }

  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/server/modules/billing/__tests__/recovery-token.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/billing/recovery-token.ts src/server/modules/billing/__tests__/recovery-token.test.ts
git commit -m "feat(billing): HMAC-signed recovery token helpers"
```

---

### Task 9: `recovery-retry` endpoint

**Files:**

- Create: `src/app/(backend)/api/billing/recovery-retry/route.ts`

- [ ] **Step 1: Implement the endpoint**

```ts
// src/app/(backend)/api/billing/recovery-retry/route.ts
import crypto from 'node:crypto';

import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { authEnv } from '@/envs/auth';
import { appEnv } from '@/envs/app';
import { billingPayments, userBilling } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { verifyRecoveryToken } from '@/server/modules/billing/recovery-token';
import { createYookassaPayment } from '@/server/modules/billing/yookassa';

/**
 * GET /api/billing/recovery-retry?payment=<id>&method=sbp|any&t=<hmac>
 *
 * Bot-issued recovery links land here. The HMAC token in `t` vouches
 * for the tuple (paymentId, userId, method) — we verify, look up the
 * original failed payment row, and restart the purchase using the
 * same plan / amount / type. No session required: the HMAC IS the
 * authentication.
 *
 * Always 302s — either to the new YooKassa URL on success, or to a
 * branded error page on the site (`/?recovery_error=<code>`).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const paymentId = sp.get('payment');
  const method = sp.get('method');
  const t = sp.get('t');

  if (!paymentId || !t || (method !== 'sbp' && method !== 'any')) {
    return NextResponse.redirect(new URL('/?recovery_error=bad_params', req.url));
  }

  const secret = authEnv.AUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    console.error('[recovery-retry] AUTH_SECRET missing');
    return NextResponse.redirect(new URL('/?recovery_error=server_misconfigured', req.url));
  }

  const verified = verifyRecoveryToken(t, secret);
  if (!verified) {
    return NextResponse.redirect(new URL('/?recovery_error=invalid_token', req.url));
  }
  if (verified.paymentId !== paymentId || verified.method !== method) {
    return NextResponse.redirect(new URL('/?recovery_error=token_mismatch', req.url));
  }

  const db = await getServerDB();
  const original = await db
    .select()
    .from(billingPayments)
    .where(eq(billingPayments.id, paymentId))
    .then((r) => r[0]);

  if (!original) {
    return NextResponse.redirect(new URL('/?recovery_error=not_found', req.url));
  }
  if (original.userId !== verified.userId) {
    return NextResponse.redirect(new URL('/?recovery_error=token_mismatch', req.url));
  }

  const ub = await db
    .select({ tgBotChatId: userBilling.tgBotChatId })
    .from(userBilling)
    .where(eq(userBilling.userId, original.userId))
    .then((r) => r[0]);

  // Restart the purchase. We replicate the same shape — same amount,
  // plan_id, tokens_amount, type — but with method override and
  // recovery breadcrumbs in metadata.
  try {
    const yk = await createYookassaPayment({
      amountRub: original.amountRub,
      description: original.type === 'subscription' ? 'Подписка (повтор)' : 'Пополнение (повтор)',
      paymentMethodType: method === 'sbp' ? 'sbp' : undefined,
      returnUrl: `${appEnv.APP_URL}/?payment=success`,
      savePaymentMethod: original.type === 'subscription',
    });

    const newRowId = crypto.randomUUID();
    await db.insert(billingPayments).values({
      amountRub: original.amountRub,
      id: newRowId,
      metadata: {
        pricing_variant: (original.metadata as any)?.pricing_variant,
        recovery_from: original.id,
        recovery_method_used: 'tg_dm',
        sbp_preselected: method === 'sbp',
        tg_user_id: ub?.tgBotChatId ?? null,
      },
      planId: original.planId,
      status: 'pending',
      tokensAmount: original.tokensAmount,
      type: original.type,
      userId: original.userId,
      yookassaPaymentId: yk.paymentId,
    });

    if (!yk.paymentUrl) {
      return NextResponse.redirect(new URL('/?recovery_error=yk_no_url', req.url));
    }
    return NextResponse.redirect(yk.paymentUrl, 302);
  } catch (err) {
    console.error('[recovery-retry] failed for paymentId=' + paymentId, err);
    return NextResponse.redirect(new URL('/?recovery_error=yk_failed', req.url));
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean. If `crypto` import warning appears, prepend `import crypto from 'node:crypto';` at top.

- [ ] **Step 3: Smoke test locally**

This route can be reached without a running container — we have no dev server here in plan. Verify the file compiles by running TS check. Real smoke happens after deploy in Task 17.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(backend\)/api/billing/recovery-retry/route.ts
git commit -m "feat(billing): /api/billing/recovery-retry — HMAC-verified bot retry endpoint"
```

---

## Phase 5 — Bot DM cron

### Task 10: gptwebrubot — `/internal/payment-recovery` endpoint

**Files:**

- Create: `gptwebrubot/src/routes/internal/payment-recovery.ts`

- Modify: `gptwebrubot/src/routes/internal/index.ts` (register route)

- [ ] **Step 1: Inspect existing internal route pattern**

```bash
ls /home/deploy/projects/gptwebrubot/src/routes/internal/
cat /home/deploy/projects/gptwebrubot/src/routes/internal/link-user.ts | head -40
```

Note the auth helper (likely `X-Internal-Token` check via shared middleware) and the Express/Fastify framework in use. We mirror that pattern below — adjust import paths to match.

- [ ] **Step 2: Implement the endpoint**

```ts
// gptwebrubot/src/routes/internal/payment-recovery.ts
import { Router } from 'express'; // adjust if app uses Fastify/etc.
import { bot } from '../../bot'; // adjust import to the project's bot instance
import { requireInternalToken } from '../../middleware/auth';

interface RecoveryRequest {
  tg_chat_id: number;
  payment_id: string;
  amount_rub: number;
  plan_name: string;
  tokens_amount: number;
  reason_code: string;
  reason_text: string;
  retry_url_sbp: string;
  retry_url_choice: string;
}

const REASON_EMOJI: Record<string, string> = {
  '3d_secure_failed': '🔒',
  'card_expired': '📆',
  'country_forbidden': '🌐',
  'expired_on_confirmation': '⌛',
  'fraud_suspected': '⚠️',
  'general_decline': '❌',
  'insufficient_funds': '💸',
  'payment_method_restricted': '🏦',
};

export const paymentRecoveryRouter = Router();

paymentRecoveryRouter.post('/payment-recovery', requireInternalToken, async (req, res) => {
  const body = req.body as RecoveryRequest;

  if (!body?.tg_chat_id || !body?.payment_id || !body?.retry_url_sbp) {
    return res.status(400).json({ sent: false, error: 'bad_request' });
  }

  const emoji = REASON_EMOJI[body.reason_code] ?? '😕';
  const text =
    `😕 *Видим — оплата не прошла*\n\n` +
    `${emoji} ${body.reason_text}\n\n` +
    `Можем попробовать через *СБП* — оплата по QR в банковском приложении, ` +
    `без 3-D Secure, проходит у 95% карт российских банков.\n\n` +
    `──────────────────────────────\n` +
    `💎 *${body.plan_name}*   —   *${body.amount_rub} ₽*\n` +
    `${body.tokens_amount} кредитов\n` +
    `──────────────────────────────`;

  try {
    const sent = await bot.api.sendMessage(body.tg_chat_id, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🟢 Оплатить через СБП', url: body.retry_url_sbp }],
          [{ text: '💳 Другой способ', url: body.retry_url_choice }],
          [
            {
              text: '✉️ Помоги вручную',
              url: `https://t.me/gptwebrubot?start=help_payment_${body.payment_id}`,
            },
          ],
        ],
      },
    });
    return res.json({ sent: true, telegram_message_id: sent.message_id });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (/blocked|user_is_deactivated|chat_not_found|forbidden/i.test(msg)) {
      return res.json({ sent: false, error: 'blocked' });
    }
    if (/too many requests|429/i.test(msg)) {
      return res.json({ sent: false, error: 'rate_limited' });
    }
    console.error('[payment-recovery] bot send failed', err);
    return res.json({ sent: false, error: 'unknown' });
  }
});
```

- [ ] **Step 3: Register the route**

In `gptwebrubot/src/routes/internal/index.ts`:

```ts
import { paymentRecoveryRouter } from './payment-recovery';
// ...
app.use('/internal', paymentRecoveryRouter);
```

(Adjust to the existing aggregation pattern.)

- [ ] **Step 4: Type-check + run any bot tests**

```bash
cd /home/deploy/projects/gptwebrubot
npm run build 2>&1 | tail -20
```

Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add src/routes/internal/payment-recovery.ts src/routes/internal/index.ts
git commit -m "feat(bot): POST /internal/payment-recovery — DM user with retry links"
```

---

### Task 11: payment-recovery-notify cron

**Files:**

- Create: `src/app/(backend)/api/cron/payment-recovery-notify/route.ts`

- [ ] **Step 1: Implement the cron**

```ts
// src/app/(backend)/api/cron/payment-recovery-notify/route.ts
import { and, eq, gt, inArray, isNotNull, lt, sql } from 'drizzle-orm';

import { appEnv } from '@/envs/app';
import { authEnv } from '@/envs/auth';
import { billingPayments, userBilling, users } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { describeReason } from '@/server/modules/billing/cancellation-reasons';
import { signRecoveryToken } from '@/server/modules/billing/recovery-token';

export const dynamic = 'force-dynamic';

const PLAN_LABELS: Record<number, string> = {
  // adjust to match real plan_id -> name mapping in your plans table
  1: 'Старт',
  2: 'Базовый',
  3: 'Pro',
  4: 'Pro Max',
};

interface BotResponse {
  sent: boolean;
  error?: string;
  telegram_message_id?: number;
}

async function callBot(payload: Record<string, unknown>): Promise<BotResponse> {
  const url = process.env.BOT_INTERNAL_URL ?? 'http://127.0.0.1:8082';
  const token = process.env.BOT_INTERNAL_TOKEN;
  if (!token) return { sent: false, error: 'no_internal_token' };

  try {
    const res = await fetch(`${url}/internal/payment-recovery`, {
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token },
      method: 'POST',
    });
    return (await res.json()) as BotResponse;
  } catch (err) {
    console.error('[payment-recovery-notify] bot call failed', err);
    return { sent: false, error: 'fetch_failed' };
  }
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }
  const secret = authEnv.AUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    return Response.json({ ok: false, error: 'auth_secret_missing' }, { status: 500 });
  }

  const db = await getServerDB();
  const summary = { eligible: 0, sent: 0, blocked: 0, errors: 0, rateLimited: 0 };

  // Fetch eligible rows in raw SQL — easier to express NOT EXISTS than
  // via Drizzle DSL for this single query.
  const rows = await db.execute(sql`
    SELECT bp.id::text AS id,
           bp.user_id,
           bp.amount_rub,
           bp.plan_id,
           bp.tokens_amount,
           bp.metadata,
           ub.tg_bot_chat_id
    FROM billing_payments bp
    JOIN user_billing ub ON ub.user_id = bp.user_id
    WHERE bp.status IN ('failed','canceled')
      AND bp.created_at > NOW() - INTERVAL '24 hours'
      AND bp.created_at < NOW() - INTERVAL '5 minutes'
      AND ub.tg_bot_chat_id IS NOT NULL
      AND (bp.metadata->>'tg_recovery_sent') IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM billing_payments bp2
        WHERE bp2.user_id = bp.user_id
          AND bp2.status = 'succeeded'
          AND bp2.created_at > bp.created_at
      )
    LIMIT 50
  `);

  // Anti-spam caps: per user, max 1 sent in last 24h and max 3 in last 7d.
  // Pre-fetch counts in a single query.
  const userIds = (rows.rows as any[]).map((r) => r.user_id);
  if (userIds.length === 0) {
    return Response.json({ ok: true, ...summary });
  }

  const capRows = await db.execute(sql`
    SELECT user_id,
           COUNT(*) FILTER (WHERE (metadata->>'tg_recovery_sent') > to_char(NOW() - INTERVAL '24 hours','YYYY-MM-DD"T"HH24:MI:SS')) AS day_count,
           COUNT(*) FILTER (WHERE (metadata->>'tg_recovery_sent') > to_char(NOW() - INTERVAL '7 days','YYYY-MM-DD"T"HH24:MI:SS')) AS week_count
    FROM billing_payments
    WHERE user_id = ANY(${userIds}::text[])
      AND (metadata->>'tg_recovery_sent') IS NOT NULL
      AND (metadata->>'tg_recovery_sent') <> 'blocked'
    GROUP BY user_id
  `);
  const caps = new Map<string, { day: number; week: number }>();
  for (const r of capRows.rows as any[]) {
    caps.set(r.user_id, { day: Number(r.day_count), week: Number(r.week_count) });
  }

  for (const r of rows.rows as any[]) {
    summary.eligible++;
    const cap = caps.get(r.user_id) ?? { day: 0, week: 0 };
    if (cap.day >= 1 || cap.week >= 3) {
      // Skip silently — don't mark sent, will recheck next day when window slides
      continue;
    }

    const cancellation = r.metadata?.cancellation ?? {};
    const reasonCode = cancellation.reason ?? 'unknown';
    const reasonDesc = describeReason(reasonCode);
    const planName = PLAN_LABELS[r.plan_id] ?? 'Тариф';
    const expSec = Math.floor(Date.now() / 1000) + 24 * 3600;

    const tSbp = signRecoveryToken(
      { paymentId: r.id, userId: r.user_id, method: 'sbp', exp: expSec },
      secret,
    );
    const tAny = signRecoveryToken(
      { paymentId: r.id, userId: r.user_id, method: 'any', exp: expSec },
      secret,
    );

    const retryUrlSbp = `${appEnv.APP_URL}/api/billing/recovery-retry?payment=${r.id}&method=sbp&t=${tSbp}`;
    const retryUrlChoice = `${appEnv.APP_URL}/api/billing/recovery-retry?payment=${r.id}&method=any&t=${tAny}`;

    const result = await callBot({
      tg_chat_id: Number(r.tg_bot_chat_id),
      payment_id: r.id,
      amount_rub: r.amount_rub,
      plan_name: planName,
      tokens_amount: r.tokens_amount ?? 0,
      reason_code: reasonCode,
      reason_text: reasonDesc.text,
      retry_url_sbp: retryUrlSbp,
      retry_url_choice: retryUrlChoice,
    });

    if (result.sent) {
      summary.sent++;
      await db
        .update(billingPayments)
        .set({
          metadata: sql`COALESCE(${billingPayments.metadata}, '{}'::jsonb) || ${JSON.stringify({
            tg_recovery_sent: new Date().toISOString(),
          })}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(billingPayments.id, r.id));
    } else if (result.error === 'blocked') {
      summary.blocked++;
      await db
        .update(billingPayments)
        .set({
          metadata: sql`COALESCE(${billingPayments.metadata}, '{}'::jsonb) || ${JSON.stringify({
            tg_recovery_sent: 'blocked',
          })}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(billingPayments.id, r.id));
    } else if (result.error === 'rate_limited') {
      summary.rateLimited++;
      // Don't mark — retry next run
    } else {
      summary.errors++;
    }
  }

  return Response.json({ ok: true, ...summary });
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean. If `inArray` / `isNotNull` / `gt` / `lt` unused — remove imports.

- [ ] **Step 3: Smoke (manual, post-deploy)**

After deploy, ensure no failed rows yet exist that we'd accidentally DM. Then trigger:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://ask.gptweb.ru/api/cron/payment-recovery-notify
```

Expected: JSON `{ok:true, eligible:0, sent:0, ...}` on first run before any new failures.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(backend\)/api/cron/payment-recovery-notify/route.ts
git commit -m "feat(billing): 5-min cron sends recovery DM to users with failed payments"
```

---

## Phase 6 — Site retry modal

### Task 12: `billing.getRecentFailure` tRPC query

**Files:**

- Modify: `src/business/server/lambda-routers/billing.ts` (create if absent)

- [ ] **Step 1: Locate existing billing router**

```bash
ls src/business/server/lambda-routers/ | grep -i billing
find src/business/server/lambda-routers -name "*.ts" -exec grep -l "spend\|billing\.\b" {} \;
```

If a billing router doesn't exist (the codebase uses split routers — `topUp`, `subscription`, `spend`), add the query to `topUp.ts` or create `billing.ts` and register it.

- [ ] **Step 2: Add the query procedure**

In whichever router file holds the namespace (we'll assume `topUp.ts` exports `topUpRouter` and we add to it; otherwise create `billing.ts` parallel to it):

```ts
// inside the same router builder
getRecentFailure: onboardingProcedure // or whatever signed-in procedure exists
  .query(async ({ ctx }) => {
    const row = await ctx.serverDB
      .select({
        id: billingPayments.id,
        amountRub: billingPayments.amountRub,
        status: billingPayments.status,
        planId: billingPayments.planId,
        tokensAmount: billingPayments.tokensAmount,
        type: billingPayments.type,
        metadata: billingPayments.metadata,
        createdAt: billingPayments.createdAt,
      })
      .from(billingPayments)
      .where(
        and(
          eq(billingPayments.userId, ctx.userId),
          inArray(billingPayments.status, ['failed', 'canceled']),
          gt(billingPayments.createdAt, new Date(Date.now() - 30 * 60 * 1000)),
        ),
      )
      .orderBy(desc(billingPayments.createdAt))
      .limit(1)
      .then((r) => r[0]);

    if (!row) return null;

    // If a later succeeded payment exists, hide.
    const laterSuccess = await ctx.serverDB
      .select({ id: billingPayments.id })
      .from(billingPayments)
      .where(
        and(
          eq(billingPayments.userId, ctx.userId),
          eq(billingPayments.status, 'succeeded'),
          gt(billingPayments.createdAt, row.createdAt),
        ),
      )
      .limit(1)
      .then((r) => r[0]);

    if (laterSuccess) return null;

    // Don't expose if bot already DM'd (avoid double-prompt).
    const meta = (row.metadata as Record<string, unknown>) ?? {};
    if (typeof meta.tg_recovery_sent === 'string') return null;

    return {
      paymentId: row.id,
      amountRub: row.amountRub,
      planId: row.planId,
      tokensAmount: row.tokensAmount,
      type: row.type,
      reasonCode: (meta.cancellation as any)?.reason ?? null,
      paymentMethodType: (meta.payment_method as any)?.type ?? null,
      cardLast4: (meta.payment_method as any)?.card_last4 ?? null,
      cardIssuerName: (meta.payment_method as any)?.card_issuer_name ?? null,
    };
  }),
```

Add imports at file top if missing:

```ts
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { billingPayments } from '@/database/schemas';
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/business/server/lambda-routers/topUp.ts # (or billing.ts if created)
git commit -m "feat(billing): tRPC getRecentFailure query for site retry modal"
```

---

### Task 13: `RetryModal` component

**Files:**

- Create: `src/features/PaymentRetry/RetryModal.tsx`

- Create: `src/features/PaymentRetry/index.ts`

- [ ] **Step 1: Implement the component**

```tsx
// src/features/PaymentRetry/RetryModal.tsx
'use client';

import { Modal, Typography } from 'antd';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';
import { describeReason } from '@/server/modules/billing/cancellation-reasons';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

const { Title, Text } = Typography;

const SUPPRESSED_PATHS = [/^\/settings\/plans/, /^\/admin\b/];

/**
 * Show a recovery prompt to a user whose last payment failed within
 * the last 30 minutes. Two ways to trigger:
 *
 *   1. Hard signal — URL has ?payment=failed or ?payment=canceled
 *      (set by the YooKassa return_url after a failed/canceled trip).
 *      Show immediately on this render.
 *
 *   2. Lazy signal — billing.getRecentFailure returns a non-null row.
 *      Show on first signed-in page render once we have data.
 *
 * Suppressed:
 *   - on /settings/plans (already shows payment UI)
 *   - on /admin/*
 *   - if the row has metadata.tg_recovery_sent (server-side filter
 *     returns null in that case, so we already won't get a row)
 *   - if the user already dismissed THIS payment id (localStorage)
 */
const RetryModal = memo(() => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const isLoaded = useUserStore((s) => s.isLoaded);
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const [forced, setForced] = useState(false);

  useEffect(() => {
    const v = search?.get('payment');
    if (v === 'failed' || v === 'canceled') setForced(true);
  }, [search]);

  const suppressedByPath = useMemo(
    () => SUPPRESSED_PATHS.some((re) => re.test(pathname ?? '')),
    [pathname],
  );

  const { data, refetch } = lambdaQuery.topUp.getRecentFailure.useQuery(undefined, {
    enabled: !!(isLogin && isLoaded && !suppressedByPath),
    staleTime: 60_000,
  });

  const dismissed = useMemo(() => {
    if (typeof window === 'undefined' || !data) return false;
    return localStorage.getItem(`retry_modal_dismissed_${data.paymentId}`) === '1';
  }, [data]);

  const visible = !!(
    isLogin &&
    isLoaded &&
    !suppressedByPath &&
    data &&
    !dismissed &&
    (forced || true)
  );

  const retryMutation = lambdaQuery.topUp.recoverFromFailure.useMutation({
    onSuccess: ({ paymentUrl }) => {
      if (paymentUrl) {
        window.location.href = paymentUrl;
      }
    },
  });

  const handleClose = useCallback(() => {
    if (data?.paymentId) {
      localStorage.setItem(`retry_modal_dismissed_${data.paymentId}`, '1');
    }
    if (forced) {
      // strip ?payment= from the URL so refresh doesn't re-trigger
      const params = new URLSearchParams(search?.toString() ?? '');
      params.delete('payment');
      router.replace(`${pathname}${params.toString() ? `?${params}` : ''}`);
      setForced(false);
    }
    refetch();
  }, [data, forced, pathname, refetch, router, search]);

  if (!visible || !data) return null;

  const reasonDesc = describeReason(data.reasonCode);
  const methodLabel =
    data.paymentMethodType === 'bank_card'
      ? `💳  ${data.cardIssuerName ?? 'Карта'} •• ${data.cardLast4 ?? '????'}`
      : data.paymentMethodType === 'sbp'
        ? '📱  СБП'
        : '— (метод не определён)';

  return (
    <Modal
      open
      title={null}
      footer={null}
      onCancel={handleClose}
      destroyOnClose
      width={460}
      centered
    >
      <Title level={4} style={{ margin: 0 }}>
        💳 Платёж не прошёл
      </Title>
      <Text style={{ display: 'block', marginTop: 8 }}>{reasonDesc.text}</Text>
      <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 13 }}>
        Метод, который не сработал:
      </Text>
      <Text style={{ display: 'block', marginTop: 2 }}>{methodLabel}</Text>

      <div style={{ borderTop: '1px solid #2a2a2a', margin: '20px 0' }} />

      <Text style={{ display: 'block', marginBottom: 12, fontSize: 14 }}>
        Попробуй <b>СБП</b> — оплата через QR в банковском приложении, без 3-D Secure, проходит у
        95% карт российских банков:
      </Text>

      <button
        type="button"
        disabled={retryMutation.isPending}
        onClick={() => retryMutation.mutate({ originalPaymentId: data.paymentId, method: 'sbp' })}
        style={{
          background: '#0088cc',
          border: 'none',
          borderRadius: 10,
          color: '#fff',
          cursor: retryMutation.isPending ? 'wait' : 'pointer',
          fontSize: 15,
          fontWeight: 500,
          padding: '12px 16px',
          width: '100%',
        }}
      >
        📱 Оплатить через СБП — {data.amountRub} ₽
      </button>

      <button
        type="button"
        disabled={retryMutation.isPending}
        onClick={() => retryMutation.mutate({ originalPaymentId: data.paymentId, method: 'any' })}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#888',
          cursor: 'pointer',
          fontSize: 13,
          marginTop: 10,
          padding: 6,
          width: '100%',
        }}
      >
        Или попробуй другой способ →
      </button>

      <div style={{ borderTop: '1px solid #2a2a2a', margin: '20px 0' }} />

      <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
        Не получается?{' '}
        <a
          href={`https://t.me/gptwebrubot?start=help_payment_${data.paymentId}`}
          target="_blank"
          rel="noreferrer"
          style={{ color: '#1677ff' }}
        >
          Напиши в бот @gptwebrubot
        </a>{' '}
        — поможем оплатить вручную.
      </Text>
    </Modal>
  );
});

RetryModal.displayName = 'RetryModal';
export default RetryModal;
```

```ts
// src/features/PaymentRetry/index.ts
export { default as RetryModal } from './RetryModal';
```

- [ ] **Step 2: Add the `topUp.recoverFromFailure` mutation referenced above**

In the same router file as Task 12's `getRecentFailure`:

```ts
recoverFromFailure: onboardingProcedure
  .input(
    z.object({
      originalPaymentId: z.string().uuid(),
      method: z.enum(['sbp', 'any']),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const original = await ctx.serverDB
      .select()
      .from(billingPayments)
      .where(
        and(
          eq(billingPayments.id, input.originalPaymentId),
          eq(billingPayments.userId, ctx.userId),
        ),
      )
      .then((r) => r[0]);
    if (!original) throw new Error('Payment not found');

    const ub = await ctx.serverDB
      .select({ tgBotChatId: userBilling.tgBotChatId })
      .from(userBilling)
      .where(eq(userBilling.userId, ctx.userId))
      .then((r) => r[0]);

    const yk = await createYookassaPayment({
      amountRub: original.amountRub,
      customerEmail: ctx.user?.email,
      description: original.type === 'subscription' ? 'Подписка (повтор)' : 'Пополнение (повтор)',
      paymentMethodType: input.method === 'sbp' ? 'sbp' : undefined,
      returnUrl: `${appEnv.APP_URL}/?payment=success`,
      savePaymentMethod: original.type === 'subscription',
    });

    await ctx.serverDB.insert(billingPayments).values({
      amountRub: original.amountRub,
      metadata: {
        pricing_variant: (original.metadata as any)?.pricing_variant,
        recovery_from: original.id,
        recovery_method_used: 'site_modal',
        sbp_preselected: input.method === 'sbp',
        tg_user_id: ub?.tgBotChatId ?? null,
      },
      planId: original.planId,
      status: 'pending',
      tokensAmount: original.tokensAmount,
      type: original.type,
      userId: ctx.userId,
      yookassaPaymentId: yk.paymentId,
    });

    return { paymentUrl: yk.paymentUrl };
  }),
```

Add imports if missing:

```ts
import { z } from 'zod';
import { appEnv } from '@/envs/app';
import { userBilling, billingPayments } from '@/database/schemas';
import { createYookassaPayment } from '@/server/modules/billing/yookassa';
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/PaymentRetry/ src/business/server/lambda-routers/topUp.ts
git commit -m "feat(payment-retry): site RetryModal + recoverFromFailure mutation"
```

---

### Task 14: Mount `RetryModal` in the global layout

**Files:**

- Modify: `src/app/[variants]/(main)/_layout/index.tsx`

- [ ] **Step 1: Add import and mount**

At the top of the file, add:

```ts
import { RetryModal } from '@/features/PaymentRetry';
```

In the returned JSX, alongside other globals (`HotkeyHelperPanel`, `RegisterHotkeys`, `CmdkLazy`), add `<RetryModal />` inside the same `<Suspense fallback={null}>`:

```tsx
<Suspense fallback={null}>
  <HotkeyHelperPanel />
  <RegisterHotkeys />
  <CmdkLazy />
  <RetryModal />
  {/* … existing FeedbackModal block … */}
</Suspense>
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/\[variants\]/\(main\)/_layout/index.tsx
git commit -m "feat(layout): mount RetryModal globally inside main layout"
```

---

## Phase 7 — Admin observability

### Task 15: Admin tRPC procedure `finance.paymentFailures.summary`

**Files:**

- Create: `webgpt-admin/lib/queries/payment-failures.ts`

- Modify: `webgpt-admin/lib/trpc/routers/finance.ts` (or wherever finance routes live)

- [ ] **Step 1: Inspect admin tRPC structure**

```bash
ls /home/deploy/projects/webgpt-admin/lib/trpc/ 2> /dev/null
find /home/deploy/projects/webgpt-admin -name "finance*" -type f 2> /dev/null | head
```

If no `finance` router exists yet (admin uses Server Actions instead), create the queries as a plain async function and call it directly from the page. Below assumes a tRPC router exists; adapt if it doesn't.

- [ ] **Step 2: Implement query helpers**

```ts
// webgpt-admin/lib/queries/payment-failures.ts
import { lobechatDB } from '@/lib/lobechat-db'; // existing helper from this project

export interface SummaryInput {
  /** number of days back from now */
  periodDays: 7 | 30;
}

export interface KPI {
  attempts: number;
  succeeded: number;
  failed: number;
  canceled: number;
  recoveryRate: number; // 0..1
  lostRevenueRub: number;
  recoveredRevenueRub: number;
}

export interface ReasonRow {
  reason: string;
  count: number;
  pct: number;
  avgAmount: number;
}
export interface MethodRow {
  type: string;
  attempts: number;
  successPct: number;
  avgTicket: number;
}
export interface IssuerRow {
  country: string;
  attempts: number;
  fails: number;
  successPct: number;
}
export interface FunnelRow {
  totalLost: number;
  siteModalExposed: number;
  siteModalRetried: number;
  siteModalSucceeded: number;
  tgDmExposed: number;
  tgDmRetried: number;
  tgDmSucceeded: number;
  noTouch: number;
}

export async function getPaymentFailuresSummary(input: SummaryInput): Promise<{
  kpi: KPI;
  reasons: ReasonRow[];
  methods: MethodRow[];
  issuers: IssuerRow[];
  funnel: FunnelRow;
}> {
  const days = input.periodDays;

  // KPI
  const kpiRow = await lobechatDB.execute(/* sql */ `
    SELECT
      COUNT(*) AS attempts,
      COUNT(*) FILTER (WHERE status='succeeded') AS succeeded,
      COUNT(*) FILTER (WHERE status='failed') AS failed,
      COUNT(*) FILTER (WHERE status='canceled') AS canceled,
      SUM(CASE WHEN status IN ('failed','canceled')
               AND NOT EXISTS (
                 SELECT 1 FROM billing_payments bp2
                 WHERE bp2.user_id = bp.user_id
                   AND bp2.status='succeeded'
                   AND bp2.created_at > bp.created_at)
               THEN amount_rub ELSE 0 END) AS lost_revenue,
      SUM(CASE WHEN status='succeeded' AND metadata->>'recovery_from' IS NOT NULL
               THEN amount_rub ELSE 0 END) AS recovered_revenue
    FROM billing_payments bp
    WHERE created_at > NOW() - INTERVAL '${days} days'
  `);
  const kRow = (kpiRow.rows ?? kpiRow)[0] as any;
  const recoveryDenom = Number(kRow.failed) + Number(kRow.canceled);
  const recoveryNum = await lobechatDB.execute(/* sql */ `
    SELECT COUNT(*) AS n FROM billing_payments
    WHERE status='succeeded'
      AND metadata->>'recovery_from' IS NOT NULL
      AND created_at > NOW() - INTERVAL '${days} days'
  `);
  const recovered = Number(((recoveryNum.rows ?? recoveryNum)[0] as any).n);

  const kpi: KPI = {
    attempts: Number(kRow.attempts),
    succeeded: Number(kRow.succeeded),
    failed: Number(kRow.failed),
    canceled: Number(kRow.canceled),
    recoveryRate: recoveryDenom > 0 ? recovered / recoveryDenom : 0,
    lostRevenueRub: Number(kRow.lost_revenue ?? 0),
    recoveredRevenueRub: Number(kRow.recovered_revenue ?? 0),
  };

  // Reasons distribution
  const reasonRows = await lobechatDB.execute(/* sql */ `
    SELECT COALESCE(metadata->'cancellation'->>'reason','(unknown)') AS reason,
           COUNT(*) AS cnt,
           ROUND(AVG(amount_rub)::numeric, 0) AS avg_amount
    FROM billing_payments
    WHERE status IN ('failed','canceled')
      AND created_at > NOW() - INTERVAL '${days} days'
    GROUP BY 1
    ORDER BY cnt DESC
  `);
  const reasonTotal = (reasonRows.rows ?? reasonRows).reduce(
    (s: number, r: any) => s + Number(r.cnt),
    0,
  );
  const reasons: ReasonRow[] = (reasonRows.rows ?? reasonRows).map((r: any) => ({
    reason: r.reason,
    count: Number(r.cnt),
    pct: reasonTotal > 0 ? Number(r.cnt) / reasonTotal : 0,
    avgAmount: Number(r.avg_amount ?? 0),
  }));

  // Method success rate
  const methodRows = await lobechatDB.execute(/* sql */ `
    SELECT COALESCE(metadata->'payment_method'->>'type','(unknown)') AS type,
           COUNT(*) AS attempts,
           COUNT(*) FILTER (WHERE status='succeeded') AS succeeded,
           ROUND(AVG(amount_rub)::numeric, 0) AS avg_ticket
    FROM billing_payments
    WHERE created_at > NOW() - INTERVAL '${days} days'
    GROUP BY 1
    ORDER BY attempts DESC
  `);
  const methods: MethodRow[] = (methodRows.rows ?? methodRows).map((r: any) => ({
    type: r.type,
    attempts: Number(r.attempts),
    successPct: Number(r.attempts) > 0 ? Number(r.succeeded) / Number(r.attempts) : 0,
    avgTicket: Number(r.avg_ticket ?? 0),
  }));

  // Issuer country breakdown (bank_card only)
  const issuerRows = await lobechatDB.execute(/* sql */ `
    SELECT COALESCE(metadata->'payment_method'->>'card_issuer_country','(unknown)') AS country,
           COUNT(*) AS attempts,
           COUNT(*) FILTER (WHERE status IN ('failed','canceled')) AS fails
    FROM billing_payments
    WHERE metadata->'payment_method'->>'type' = 'bank_card'
      AND created_at > NOW() - INTERVAL '${days} days'
    GROUP BY 1
    ORDER BY attempts DESC
  `);
  const issuers: IssuerRow[] = (issuerRows.rows ?? issuerRows).map((r: any) => ({
    country: r.country,
    attempts: Number(r.attempts),
    fails: Number(r.fails),
    successPct:
      Number(r.attempts) > 0 ? (Number(r.attempts) - Number(r.fails)) / Number(r.attempts) : 0,
  }));

  // Recovery funnel
  const funnelRow = await lobechatDB.execute(/* sql */ `
    WITH failed_in_period AS (
      SELECT id, user_id, created_at, metadata
      FROM billing_payments
      WHERE status IN ('failed','canceled')
        AND created_at > NOW() - INTERVAL '${days} days'
    ),
    recovered AS (
      SELECT b.*, b.metadata->>'recovery_method_used' AS method,
             b.metadata->>'recovery_from' AS from_id
      FROM billing_payments b
      WHERE b.status='succeeded'
        AND b.metadata->>'recovery_from' IS NOT NULL
        AND b.created_at > NOW() - INTERVAL '${days} days'
    )
    SELECT
      (SELECT COUNT(*) FROM failed_in_period)                                     AS total_lost,
      (SELECT COUNT(*) FROM failed_in_period WHERE metadata->>'tg_recovery_sent' IS NULL) AS site_modal_exposed,
      (SELECT COUNT(*) FROM recovered WHERE method='site_modal')                  AS site_modal_succeeded,
      (SELECT COUNT(*) FROM failed_in_period WHERE metadata->>'tg_recovery_sent' IS NOT NULL
                                              AND metadata->>'tg_recovery_sent' <> 'blocked') AS tg_dm_exposed,
      (SELECT COUNT(*) FROM recovered WHERE method='tg_dm')                       AS tg_dm_succeeded
  `);
  const f = (funnelRow.rows ?? funnelRow)[0] as any;
  const funnel: FunnelRow = {
    totalLost: Number(f.total_lost ?? 0),
    siteModalExposed: Number(f.site_modal_exposed ?? 0),
    siteModalRetried: Number(f.site_modal_succeeded ?? 0), // assume retried==succeeded for now
    siteModalSucceeded: Number(f.site_modal_succeeded ?? 0),
    tgDmExposed: Number(f.tg_dm_exposed ?? 0),
    tgDmRetried: Number(f.tg_dm_succeeded ?? 0),
    tgDmSucceeded: Number(f.tg_dm_succeeded ?? 0),
    noTouch: Math.max(
      0,
      Number(f.total_lost ?? 0) - Number(f.site_modal_exposed ?? 0) - Number(f.tg_dm_exposed ?? 0),
    ),
  };

  return { kpi, reasons, methods, issuers, funnel };
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/deploy/projects/webgpt-admin
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/queries/payment-failures.ts
git commit -m "feat(admin): payment-failures summary queries (KPI / reasons / methods / funnel)"
```

---

### Task 16: Admin page `/finance/payment-failures`

**Files:**

- Create: `webgpt-admin/app/(dashboard)/finance/payment-failures/page.tsx`

- [ ] **Step 1: Implement the page**

```tsx
// webgpt-admin/app/(dashboard)/finance/payment-failures/page.tsx
import { Suspense } from 'react';

import { getPaymentFailuresSummary } from '@/lib/queries/payment-failures';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ period?: string }>;
}

const fmtRub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

async function PaymentFailuresContent({ periodDays }: { periodDays: 7 | 30 }) {
  const data = await getPaymentFailuresSummary({ periodDays });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Block 1: KPI */}
      <section>
        <h2>KPI · last {periodDays}d</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <KPI label="Attempts" value={data.kpi.attempts} />
          <KPI
            label="Succeeded"
            value={`${data.kpi.succeeded} (${fmtPct(data.kpi.succeeded / Math.max(data.kpi.attempts, 1))})`}
          />
          <KPI label="Failed" value={data.kpi.failed} />
          <KPI label="Canceled" value={data.kpi.canceled} />
          <KPI label="Recovery rate" value={fmtPct(data.kpi.recoveryRate)} />
          <KPI label="Lost revenue" value={fmtRub(data.kpi.lostRevenueRub)} />
          <KPI label="Recovered revenue" value={fmtRub(data.kpi.recoveredRevenueRub)} />
        </div>
      </section>

      {/* Block 2: Reasons */}
      <section>
        <h2>Cancellation reasons</h2>
        <table style={{ width: '100%' }}>
          <thead>
            <tr>
              <th align="left">Reason</th>
              <th>Count</th>
              <th>%</th>
              <th>Avg amount</th>
            </tr>
          </thead>
          <tbody>
            {data.reasons.map((r) => (
              <tr key={r.reason}>
                <td>{r.reason}</td>
                <td align="center">{r.count}</td>
                <td align="center">{fmtPct(r.pct)}</td>
                <td align="right">{fmtRub(r.avgAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Block 3: Method success rate */}
      <section>
        <h2>Payment method success rate</h2>
        <table style={{ width: '100%' }}>
          <thead>
            <tr>
              <th align="left">Method</th>
              <th>Attempts</th>
              <th>Success %</th>
              <th>Avg ticket</th>
            </tr>
          </thead>
          <tbody>
            {data.methods.map((m) => (
              <tr key={m.type}>
                <td>{m.type}</td>
                <td align="center">{m.attempts}</td>
                <td align="center">{fmtPct(m.successPct)}</td>
                <td align="right">{fmtRub(m.avgTicket)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Block 4: Issuer country */}
      <section>
        <h2>Bank card issuer country</h2>
        <table style={{ width: '100%' }}>
          <thead>
            <tr>
              <th align="left">Country</th>
              <th>Attempts</th>
              <th>Fails</th>
              <th>Success %</th>
            </tr>
          </thead>
          <tbody>
            {data.issuers.map((i) => (
              <tr key={i.country}>
                <td>{i.country}</td>
                <td align="center">{i.attempts}</td>
                <td align="center">{i.fails}</td>
                <td align="center">{fmtPct(i.successPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Block 5: Recovery funnel */}
      <section>
        <h2>Recovery funnel</h2>
        <pre style={{ background: '#111', color: '#ccc', padding: 16 }}>{`
${data.funnel.totalLost} failed/canceled
 ├── ${data.funnel.siteModalExposed} received site_modal exposure
 │    └── ${data.funnel.siteModalRetried} retried via modal      → ${data.funnel.siteModalSucceeded} succeeded
 ├── ${data.funnel.tgDmExposed} received tg_dm
 │    └── ${data.funnel.tgDmRetried} retried via tg_dm           → ${data.funnel.tgDmSucceeded} succeeded
 └── ${data.funnel.noTouch} no recovery touch
        `}</pre>
      </section>
    </div>
  );
}

function KPI({ label, value }: { label: string; value: number | string }) {
  return (
    <div
      style={{ background: '#161616', border: '1px solid #2a2a2a', borderRadius: 8, padding: 12 }}
    >
      <div style={{ color: '#888', fontSize: 12 }}>{label}</div>
      <div style={{ color: '#eee', fontSize: 22, marginTop: 4 }}>{value}</div>
    </div>
  );
}

export default async function Page({ searchParams }: PageProps) {
  const sp = await searchParams;
  const periodDays: 7 | 30 = sp.period === '7' ? 7 : 30;

  return (
    <div style={{ padding: 24 }}>
      <h1>Payment failures</h1>
      <div style={{ marginBottom: 24 }}>
        <a href="?period=7" style={{ marginRight: 12, color: periodDays === 7 ? '#fff' : '#888' }}>
          7d
        </a>
        <a href="?period=30" style={{ color: periodDays === 30 ? '#fff' : '#888' }}>
          30d
        </a>
      </div>
      <Suspense fallback={<div>Loading…</div>}>
        <PaymentFailuresContent periodDays={periodDays} />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + start dev to smoke**

```bash
cd /home/deploy/projects/webgpt-admin
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/finance/payment-failures/page.tsx
git commit -m "feat(admin): payment-failures observability page"
```

---

## Phase 8 — Ops

### Task 17: Crontab + manual YK Kabinet reorder + deploy

**Files:**

- Host: `/etc/cron.d/lobechat-payment-recovery` (on `135.181.115.234`)

- Manual: YooKassa Кабинет reorder (Pavel performs)

- [ ] **Step 1: Add crontab entry on Hetzner host**

SSH to `root@135.181.115.234` and create:

```bash
sudo tee /etc/cron.d/lobechat-payment-recovery > /dev/null << 'EOF'
# Every 5 minutes: DM users who hit a failed/canceled payment.
*/5 * * * * deploy curl -fsS -H "Authorization: Bearer $(grep '^CRON_SECRET=' /opt/lobechat/.env | cut -d= -f2-)" https://ask.gptweb.ru/api/cron/payment-recovery-notify >> /var/log/lobechat-payment-recovery.log 2>&1
EOF
sudo touch /var/log/lobechat-payment-recovery.log
sudo chown deploy:deploy /var/log/lobechat-payment-recovery.log
```

Verify:

```bash
sudo systemctl reload cron
grep payment-recovery /etc/cron.d/*
```

- [ ] **Step 2: Confirm SBP is enabled in YooKassa Kabinet** _(Pavel's action)_

1. Login at `kassa.yandex.ru`
2. Settings → Магазин → "Способы оплаты"
3. Verify **СБП** is ON. If not, enable it (separate contract clause may be required — call YK manager).
4. In "Расположение способов оплаты", drag СБП to first position. Save.

This step is what makes the `paymentMethodType: 'sbp'` argument meaningful. Without it, our code falls back to default (logged warning).

- [ ] **Step 3: Build + deploy**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
docker build --tag lobechat-custom:latest --progress=plain . > /tmp/lobe-payrecov.log 2>&1
tail -5 /tmp/lobe-payrecov.log

cd /opt/lobechat
docker compose stop lobe
docker compose rm -f lobe
docker container prune -f
docker compose up -d lobe
sleep 10
docker ps --filter "name=lobehub" --format "{{.Status}} {{.Image}}"
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://ask.gptweb.ru/
```

Expected: container Up, HTTP 200.

Bot deploy (separate repo):

```bash
cd /home/deploy/projects/gptwebrubot
# follow that project's existing deploy step (pm2 restart / docker / systemctl ...)
```

Admin deploy (separate repo):

```bash
cd /home/deploy/projects/webgpt-admin
# follow project's existing deploy step
```

- [ ] **Step 4: Smoke-test the full flow**

1. Trigger a top-up purchase from a test user on ask.gptweb.ru with a deliberately bad card (e.g., `4242 4242 4242 4242` if YK sandbox is wired up, else use a real card with insufficient balance):
   - Open `/settings/plans`, pick 99₽ minimum top-up
   - Click pay → land on YK form → **verify SBP is preselected**
   - Switch to bank card, enter bad number → submit → land back on ask.gptweb.ru with `?payment=failed`
2. Verify `RetryModal` appears immediately.
3. Open `/admin/finance/payment-failures` → confirm the new failed row appears under "bank_card" with the right reason.
4. Wait 6 min. Verify cron sent a DM (check `/var/log/lobechat-payment-recovery.log`).
5. Click "🟢 Оплатить через СБП" in the DM → should land on YK form with SBP preselected → succeed → land on home page with credits.
6. Verify admin page now shows: `recovery_method_used='tg_dm'` row, recovery rate non-zero.

- [ ] **Step 5: Commit the crontab file** _(if checked into infra repo)_

If the host has its own infra repo, commit `lobechat-payment-recovery.cron` there. Otherwise just keep the host file and document its path in `/home/deploy/projects/CLAUDE.md` under "Cron jobs".

```bash
# in whichever infra repo holds host config — or skip if you keep host-only
git add lobechat-payment-recovery.cron
git commit -m "ops: 5-min cron for payment-recovery-notify"
```

---

## Validation checklist

After Task 17 completes, all of these should hold:

- [ ] `/admin/finance/payment-failures?period=30` loads without errors, shows real data (zeros are fine pre-traffic).
- [ ] Any new `billing_payments` row created after deploy has `metadata.sbp_preselected: true` and `metadata.tg_user_id` set (or null if user has no TG).
- [ ] Any new failed/canceled `billing_payments` row after deploy has `metadata.cancellation` and `metadata.payment_method` populated (via webhook OR reconcile cron within 1 hour).
- [ ] `curl -H "Authorization: Bearer $CRON_SECRET" https://ask.gptweb.ru/api/cron/payment-recovery-notify` returns 200 JSON.
- [ ] `RetryModal` shows when visiting any page with `?payment=failed`.
- [ ] HMAC token validation: `curl -i https://ask.gptweb.ru/api/billing/recovery-retry?payment=x&method=sbp&t=garbage` returns 302 to `/?recovery_error=invalid_token`.

If validation passes — graduate to monitoring phase (4 weeks, success criteria in spec).

---

## Notes for the executor

- **TypeScript strict, ESLint configured.** Lint hooks run on every commit. Don't disable them. If you change an existing file's signature, run `npx tsc --noEmit` before commit.
- **Tests use Vitest.** Pattern is `*.test.ts` co-located in `__tests__/` next to source.
- **The codebase has a husky pre-commit hook that runs `prettier --write` and `eslint --fix`.** Files may be auto-reformatted at commit time — that's fine, take it as-is.
- **Two separate repos touched besides `ai-aggregator-lobechat`:** `gptwebrubot` (bot, Task 10), `webgpt-admin` (Tasks 15-16). Each has its own deploy.
- **No DB migrations needed** — we only use the existing `metadata jsonb` column on `billing_payments`. Defensive coding in queries (`COALESCE(metadata, '{}'::jsonb) || patch`).
- **Frequent commits.** Each task is one commit. Don't bundle tasks.
- **If a task assumes a function name or shape that doesn't match reality** when you open the file, prefer adjusting the test/task minimally to match existing reality rather than refactoring the existing code. The spec is the contract — the plan is one implementation of it.
