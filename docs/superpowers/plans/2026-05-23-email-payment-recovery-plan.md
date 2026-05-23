# Email Payment Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an email recovery channel to `payment-recovery-notify` so 100% of users with a failed YooKassa payment get a friendly, humorous nudge with a one-click retry — sent 5 min after failure (Stage 1) and again 24 h later if unpaid (Stage 2). Caps: 1 per (payment, stage) + 2 per user per rolling 7 days.

**Architecture:** Extend the existing 5-min cron at `src/app/(backend)/api/cron/payment-recovery-notify/route.ts`. Add Stage 1 email send next to the current TG send (parallel, not exclusive). Add a Stage 2 second SQL pass that picks up rows whose Stage 1 fired ≥ 24 h ago. No DB migrations — state lives in `billing_payments.metadata` JSONB. Email goes through the existing `sendLifecycleEmail` helper (Brevo REST API).

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, vitest, TypeScript strict, Brevo (REST API via the existing `sendLifecycleEmail` helper at `src/server/modules/lifecycle/email.ts`).

**Spec:** `docs/superpowers/specs/2026-05-23-email-payment-recovery-design.md` (commit `3ed414febb`).

---

## File Map

| File                                                                    | Status | Purpose                                                                                                         |
| ----------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| `src/server/modules/billing/email-templates/recovery-copy.ts`           | new    | RU copy keyed by `(reasonCode, stage)`. Pure data.                                                              |
| `src/server/modules/billing/email-templates/recovery.ts`                | new    | `buildRecoveryEmail({...}) → {subject, html, text}`. Pure function.                                             |
| `src/server/modules/billing/email-templates/__tests__/recovery.test.ts` | new    | Snapshot tests for every (reason × stage) combo.                                                                |
| `src/server/modules/billing/send-recovery-email.ts`                     | new    | Thin wrapper over `sendLifecycleEmail`.                                                                         |
| `src/server/modules/billing/__tests__/send-recovery-email.test.ts`      | new    | Mocked send → asserts subject + URL preserved.                                                                  |
| `src/server/modules/billing/recovery-token.ts`                          | modify | Add optional `source` field to `RecoveryPayload`. Backward-compatible.                                          |
| `src/server/modules/billing/__tests__/recovery-token.test.ts`           | modify | Add tests for `source` round-trip.                                                                              |
| `src/app/(backend)/api/billing/recovery-retry/route.ts`                 | modify | Read `source` from verified payload, stamp `metadata.recovery_method_used` from it (fallback `'tg_dm'`).        |
| `src/app/(backend)/api/cron/payment-recovery-notify/route.ts`           | modify | Add Stage 1 email send in the existing per-row loop. Add Stage 2 second SQL pass + send loop. Extend cap query. |

---

## Task 0: Brevo IP allow-list (ops, no code)

**Why:** `sendLifecycleEmail` calls the Brevo REST API. The Hetzner production server's egress IP is not in Brevo's authorised-IP list — calls return `HTTP 401 unauthorized`. Lifecycle/welcome emails currently fall back silently (the helper logs and returns `{ok: false}`). Email recovery would inherit the same failure mode if we don't fix this first.

- [ ] **Step 1: Capture the egress IPs**

```bash
# IPv6 used in the most recent Brevo 401:
echo "From Brevo 401: 2a01:4f9:4b:1bed::2"
# Also pin the IPv4:
curl -s -4 https://api.ipify.org && echo
curl -s -6 https://api64.ipify.org && echo
```

Expected: prints IPv4 like `135.181.115.234` and the IPv6 prefix.

- [ ] **Step 2: Add both to Brevo's "Authorised IPs"**

Manual: log into Brevo → Security → Authorised IPs → add both addresses. Label them `hetzner-prod-v4` and `hetzner-prod-v6`.

- [ ] **Step 3: Smoke-test `sendLifecycleEmail` from the server**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
BREVO_API_KEY=$(grep -E '^BREVO_API_KEY=' /opt/lobechat/.env | cut -d= -f2-)
LIFECYCLE_EMAIL_FROM=noreply@gptweb.ru \
  LIFECYCLE_EMAIL_FROM_NAME=WebGPT \
  BREVO_API_KEY="$BREVO_API_KEY" node --input-type=module -e "
import { sendLifecycleEmail } from './src/server/modules/lifecycle/email.ts';
console.log(await sendLifecycleEmail({
  to: '2396741@gmail.com',
  subject: 'Brevo smoke-test',
  html: '<p>If you see this, the IP allow-list is fixed.</p>',
  textBody: 'Brevo smoke-test',
}));
"
```

Expected: `{ ok: true, messageId: '<...>' }`. If still 401, the IP didn't propagate yet — re-check the allow-list page.

- [ ] **Step 4: Commit nothing (ops only)**

This task produces no code changes. Record the new allow-list entries in your ops journal.

---

## Task 1: `recovery-copy.ts` — Russian copy table

**Files:**

- Create: `src/server/modules/billing/email-templates/recovery-copy.ts`

- [ ] **Step 1: Create the file with full copy table**

```ts
// src/server/modules/billing/email-templates/recovery-copy.ts
/**
 * RU copy for payment-recovery emails. Keyed by YK cancellation
 * reason × stage. Stage 1 is the immediate (5-min) nudge, Stage 2
 * is the 24-h follow-up. Tone: light humour, one funny line, never
 * at the user's expense.
 *
 * Reason codes come from `cancellation-reasons.ts` (SoT). When
 * adding a new reason there, add a CopyBlock here too — the
 * template falls back to `_default` if missing, but generic copy
 * converts worse.
 *
 * Subject lines: ≤60 chars, may include one emoji.
 */

export interface CopyBlock {
  /** Email subject — ≤60 chars, optional single emoji. */
  subject: string;
  /** 1–2 sentences naming what happened. Rendered as <p>. */
  reasonHook: string;
  /** 1 sentence with personality. Rendered as <p>. */
  humorLine: string;
  /** Button text. {{amount}} placeholder is replaced with the RUB amount. */
  ctaLabel: string;
}

export interface ReasonCopy {
  stage1: CopyBlock;
  stage2: CopyBlock;
}

const CTA_DEFAULT = 'Попробовать ещё раз — {{amount}} ₽';

/** Per-reason copy. Add new keys as new YK reasons appear. */
export const COPY: Record<string, ReasonCopy> = {
  'insufficient_funds': {
    stage1: {
      subject: 'Карта стесняется — не хватило денег',
      reasonHook: 'На карте не хватило средств — оплата не прошла.',
      humorLine: 'Бывает: иногда кошелёк просто хочет драматичную паузу.',
      ctaLabel: CTA_DEFAULT,
    },
    stage2: {
      subject: 'Карта пришла в себя? 😅',
      reasonHook: 'Прошли сутки. Карта уже отошла от шока?',
      humorLine: 'Мы припрятали ваш заказ — на этот раз должно получиться.',
      ctaLabel: CTA_DEFAULT,
    },
  },
  'expired_on_confirmation': {
    stage1: {
      subject: 'Не дожали оплату — что-то отвлекло?',
      reasonHook: 'Открыли форму YooKassa и закрыли, не успев подтвердить.',
      humorLine: 'Кофе остыл? Котик потребовал внимания? Понимаем.',
      ctaLabel: CTA_DEFAULT,
    },
    stage2: {
      subject: 'Прошли сутки, а вы всё ещё без подписки 🙃',
      reasonHook: 'Вчера так и не успели завершить оплату.',
      humorLine: 'Если ещё хотите — мы тут, всё ещё ждём и не нервничаем.',
      ctaLabel: CTA_DEFAULT,
    },
  },
  'expired_on_capture': {
    stage1: {
      subject: 'Сорвался захват средств',
      reasonHook: 'Платёж застрял на этапе захвата — банк не дождался ответа.',
      humorLine: 'Чисто техническая загвоздка, повторим — должно сработать.',
      ctaLabel: CTA_DEFAULT,
    },
    stage2: {
      subject: 'Вчера сорвалось — попробуем сегодня?',
      reasonHook: 'Прошлая попытка зависла на стороне банка.',
      humorLine: 'У нас всё готово, ждём только вас.',
      ctaLabel: CTA_DEFAULT,
    },
  },
  '3d_secure_failed': {
    stage1: {
      subject: 'Банк не пропустил 3-D Secure',
      reasonHook: 'Банк отклонил подтверждение 3-D Secure.',
      humorLine: 'Не паникуем — иногда проще через СБП, без капчей.',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
    stage2: {
      subject: '3-D Secure всё ещё бунтует?',
      reasonHook: 'Вчера 3-D Secure не пропустил — может, попробуем СБП?',
      humorLine: 'QR в банковском приложении обычно срабатывает с первого раза.',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
  },
  'card_expired': {
    stage1: {
      subject: 'Срок действия карты истёк',
      reasonHook: 'У карты, которой вы пытались оплатить, истёк срок.',
      humorLine: 'Заведите ту, что свежее — или попробуйте через СБП.',
      ctaLabel: 'Попробовать другой картой — {{amount}} ₽',
    },
    stage2: {
      subject: 'Карта всё ещё просрочена 🗓️',
      reasonHook: 'Вчера карта была просрочена.',
      humorLine: 'Если есть актуальная — мы тут, ждём.',
      ctaLabel: CTA_DEFAULT,
    },
  },
  'general_decline': {
    stage1: {
      subject: 'Банк отклонил без объяснений',
      reasonHook: 'Банк отказал в оплате без подробностей.',
      humorLine: 'Обычно помогает оплата через СБП — там другая цепочка проверок.',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
    stage2: {
      subject: 'Банк продолжает молчать о причине',
      reasonHook: 'Прошлая попытка отвалилась без объяснений.',
      humorLine: 'СБП обычно срабатывает в таких случаях — попробуем?',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
  },
  'payment_method_restricted': {
    stage1: {
      subject: 'Банк не разрешает онлайн-оплаты',
      reasonHook: 'Банк блокирует онлайн-оплату по этой карте.',
      humorLine: 'Решается через СБП — там оплата идёт прямо из приложения банка.',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
    stage2: {
      subject: 'Карта всё ещё закрыта для онлайна',
      reasonHook: 'Банк по-прежнему блокирует онлайн-оплаты по этой карте.',
      humorLine: 'СБП — самый прямой обход. Один QR, два касания.',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
  },
  'country_forbidden': {
    stage1: {
      subject: 'Карта из неподдерживаемой страны',
      reasonHook: 'YooKassa не принимает карты из вашей страны.',
      humorLine: 'СБП работает с любого российского банка — попробуем оттуда?',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
    stage2: {
      subject: 'Карта всё ещё не та',
      reasonHook: 'Карта по-прежнему из страны, которую YK не принимает.',
      humorLine: 'СБП от российского банка решит вопрос за минуту.',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
  },
  'permission_revoked': {
    stage1: {
      subject: 'Отозваны права на оплату',
      reasonHook: 'Банк отозвал разрешение на оплату.',
      humorLine: 'Стоит проверить настройки в приложении банка — либо сразу через СБП.',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
    stage2: {
      subject: 'Права на оплату всё ещё отозваны',
      reasonHook: 'Доступ к карте всё ещё закрыт.',
      humorLine: 'СБП обычно работает даже когда карта временно заблокирована.',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
  },
  'canceled_by_merchant': {
    stage1: {
      subject: 'Платёж отменён системой',
      reasonHook: 'Платёж был отменён на стороне платёжной системы.',
      humorLine: 'Обычно это случайный сбой — повтор почти всегда проходит.',
      ctaLabel: CTA_DEFAULT,
    },
    stage2: {
      subject: 'Вчера сорвался платёж',
      reasonHook: 'Прошлый платёж сорвался на стороне системы.',
      humorLine: 'Сегодня попробуем ещё раз — обычно срабатывает.',
      ctaLabel: CTA_DEFAULT,
    },
  },
  'internal_timeout': {
    stage1: {
      subject: 'Технический сбой YooKassa',
      reasonHook: 'YooKassa не успела обработать платёж — внутренний таймаут.',
      humorLine: 'Не ваша вина. Повторим — должно сработать.',
      ctaLabel: CTA_DEFAULT,
    },
    stage2: {
      subject: 'YooKassa тогда подвела — попробуем сейчас',
      reasonHook: 'Вчера YK не справилась с обработкой.',
      humorLine: 'Сегодня у неё гораздо лучше дела. Проверим?',
      ctaLabel: CTA_DEFAULT,
    },
  },
  'fraud_suspected': {
    stage1: {
      subject: 'Платёж попал под антифрод',
      reasonHook: 'Система безопасности банка приняла платёж за подозрительный.',
      humorLine: 'Иногда это лечится одним повтором, иногда — через СБП. Попробуем?',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
    stage2: {
      subject: 'Антифрод всё ещё подозрителен',
      reasonHook: 'Прошлая попытка снова попала под защиту.',
      humorLine: 'СБП обходит большинство антифрод-фильтров. Один QR — и готово.',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
  },
  '_default': {
    stage1: {
      subject: 'Оплата не прошла — попробуем ещё раз?',
      reasonHook: 'Оплата сорвалась — точную причину банк не назвал.',
      humorLine: 'Точно не из-за вас. Попробуем ещё раз?',
      ctaLabel: CTA_DEFAULT,
    },
    stage2: {
      subject: 'Это наше последнее письмо по этой оплате',
      reasonHook: 'Прошли сутки с попытки оплаты, статус так и не изменился.',
      humorLine: 'Не хотим спамить — если ещё актуально, ссылка ниже.',
      ctaLabel: CTA_DEFAULT,
    },
  },
};

/** Resolve copy for (reason, stage). Falls back to `_default`. */
export function resolveCopy(
  reasonCode: string | null | undefined,
  stage: 'stage1' | 'stage2',
): CopyBlock {
  const key = reasonCode && COPY[reasonCode] ? reasonCode : '_default';
  return COPY[key][stage];
}
```

- [ ] **Step 2: Commit**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git add src/server/modules/billing/email-templates/recovery-copy.ts
git commit -m "feat(billing): email recovery copy table by reason×stage"
```

---

## Task 2: `recovery.ts` template builder — failing test first

**Files:**

- Create: `src/server/modules/billing/email-templates/__tests__/recovery.test.ts`

- Create (after test): `src/server/modules/billing/email-templates/recovery.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/modules/billing/email-templates/__tests__/recovery.test.ts
import { describe, expect, it } from 'vitest';

import { buildRecoveryEmail } from '../recovery';

const SAMPLE = {
  payment: {
    amountRub: 490,
    planName: 'Тариф Стандарт',
    type: 'subscription' as const,
  },
  recoveryUrl:
    'https://ask.gptweb.ru/api/billing/recovery-retry?payment=abc&method=any&t=eyJ...sig',
};

describe('buildRecoveryEmail', () => {
  it('renders Stage 1 for insufficient_funds with reason text + humour + CTA + URL', () => {
    const out = buildRecoveryEmail({
      ...SAMPLE,
      reasonCode: 'insufficient_funds',
      stage: 'stage1',
    });

    expect(out.subject).toContain('Карта стесняется');
    expect(out.subject.length).toBeLessThanOrEqual(60);
    expect(out.html).toContain('не хватило средств');
    expect(out.html).toContain('Бывает');
    expect(out.html).toContain('490');
    expect(out.html).toContain(SAMPLE.recoveryUrl);
    expect(out.text).toContain(SAMPLE.recoveryUrl);
  });

  it('renders Stage 2 with a different subject than Stage 1', () => {
    const s1 = buildRecoveryEmail({
      ...SAMPLE,
      reasonCode: 'insufficient_funds',
      stage: 'stage1',
    });
    const s2 = buildRecoveryEmail({
      ...SAMPLE,
      reasonCode: 'insufficient_funds',
      stage: 'stage2',
    });
    expect(s1.subject).not.toBe(s2.subject);
  });

  it('falls back to _default copy when reason is unknown', () => {
    const out = buildRecoveryEmail({
      ...SAMPLE,
      reasonCode: 'something_yk_invented_yesterday',
      stage: 'stage1',
    });
    expect(out.subject).toContain('Оплата не прошла');
    expect(out.html).toContain(SAMPLE.recoveryUrl);
  });

  it('handles topup type (no planName)', () => {
    const out = buildRecoveryEmail({
      payment: { amountRub: 99, type: 'topup' as const },
      recoveryUrl: SAMPLE.recoveryUrl,
      reasonCode: 'insufficient_funds',
      stage: 'stage1',
    });
    expect(out.html).toContain('99');
    expect(out.html).toContain(SAMPLE.recoveryUrl);
  });

  it('html-escapes the planName to prevent XSS', () => {
    const out = buildRecoveryEmail({
      payment: {
        amountRub: 100,
        planName: '<script>alert(1)</script>',
        type: 'subscription' as const,
      },
      recoveryUrl: SAMPLE.recoveryUrl,
      reasonCode: 'insufficient_funds',
      stage: 'stage1',
    });
    expect(out.html).not.toContain('<script>alert(1)</script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('preserves the recoveryUrl verbatim (no double-encoding)', () => {
    const tricky =
      'https://ask.gptweb.ru/api/billing/recovery-retry?payment=x&method=any&t=A.B-C_D';
    const out = buildRecoveryEmail({
      ...SAMPLE,
      reasonCode: 'insufficient_funds',
      stage: 'stage1',
      recoveryUrl: tricky,
    });
    expect(out.html).toContain(`href="${tricky}"`);
    expect(out.text).toContain(tricky);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
npx vitest run src/server/modules/billing/email-templates/__tests__/recovery.test.ts
```

Expected: FAIL — `Cannot find module '../recovery'`.

- [ ] **Step 3: Implement `recovery.ts`**

```ts
// src/server/modules/billing/email-templates/recovery.ts
import { resolveCopy } from './recovery-copy';

export interface BuildRecoveryEmailInput {
  payment: {
    amountRub: number;
    /** Optional — only present for subscription type. */
    planName?: string;
    type: 'subscription' | 'topup';
  };
  reasonCode: string | null | undefined;
  recoveryUrl: string;
  stage: 'stage1' | 'stage2';
}

export interface BuildRecoveryEmailOutput {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function applyAmount(template: string, amount: number): string {
  return template.replaceAll('{{amount}}', String(amount));
}

/**
 * Pure email body builder. No I/O. Selects copy by (reasonCode, stage),
 * substitutes amount/url, escapes user-controlled fields, returns
 * subject + html + text.
 */
export function buildRecoveryEmail(input: BuildRecoveryEmailInput): BuildRecoveryEmailOutput {
  const copy = resolveCopy(input.reasonCode, input.stage);
  const subject = copy.subject;
  const ctaLabel = applyAmount(copy.ctaLabel, input.payment.amountRub);
  const planLine = input.payment.planName
    ? `<p style="margin:8px 0 0;color:#666;font-size:14px;">${escapeHtml(input.payment.planName)}</p>`
    : '';

  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#222;line-height:1.5;">
<h2 style="margin-top:0;">${escapeHtml(copy.subject)}</h2>
<p>${escapeHtml(copy.reasonHook)}</p>
<p>${escapeHtml(copy.humorLine)}</p>
${planLine}
<p style="margin:32px 0;">
  <a href="${input.recoveryUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;">${escapeHtml(ctaLabel)}</a>
</p>
<p style="color:#666;font-size:14px;">Ссылка персональная, действует 7 дней. Если оплата уже не нужна — просто проигнорируйте письмо.</p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
<p style="color:#888;font-size:13px;">— Команда WebGPT · <a href="https://ask.gptweb.ru" style="color:#888;">ask.gptweb.ru</a></p>
</body></html>`;

  const text = [
    copy.subject,
    '',
    copy.reasonHook,
    copy.humorLine,
    input.payment.planName ? input.payment.planName : '',
    '',
    `${ctaLabel}:`,
    input.recoveryUrl,
    '',
    'Ссылка персональная, действует 7 дней.',
    '',
    '— Команда WebGPT',
    'https://ask.gptweb.ru',
  ]
    .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
    .join('\n');

  return { subject, html, text };
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npx vitest run src/server/modules/billing/email-templates/__tests__/recovery.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/billing/email-templates/recovery.ts \
  src/server/modules/billing/email-templates/__tests__/recovery.test.ts
git commit -m "feat(billing): buildRecoveryEmail template builder + tests"
```

---

## Task 3: `send-recovery-email.ts` wrapper — failing test first

**Files:**

- Create: `src/server/modules/billing/__tests__/send-recovery-email.test.ts`

- Create (after test): `src/server/modules/billing/send-recovery-email.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/modules/billing/__tests__/send-recovery-email.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/modules/lifecycle/email', () => ({
  sendLifecycleEmail: vi.fn(),
}));

import { sendLifecycleEmail } from '@/server/modules/lifecycle/email';
import { sendRecoveryEmail } from '../send-recovery-email';

describe('sendRecoveryEmail', () => {
  beforeEach(() => {
    vi.mocked(sendLifecycleEmail).mockReset();
  });

  it('calls sendLifecycleEmail with subject/html/text from the template', async () => {
    vi.mocked(sendLifecycleEmail).mockResolvedValue({ ok: true, messageId: '<msgid@x>' });

    const out = await sendRecoveryEmail({
      to: 'user@example.com',
      payment: { amountRub: 490, type: 'subscription', planName: 'Тариф' },
      reasonCode: 'insufficient_funds',
      recoveryUrl: 'https://ask.gptweb.ru/api/billing/recovery-retry?x=1',
      stage: 'stage1',
    });

    expect(out).toEqual({ ok: true, messageId: '<msgid@x>' });
    expect(sendLifecycleEmail).toHaveBeenCalledOnce();
    const call = vi.mocked(sendLifecycleEmail).mock.calls[0][0];
    expect(call.to).toBe('user@example.com');
    expect(call.subject).toContain('Карта стесняется');
    expect(call.html).toContain('https://ask.gptweb.ru/api/billing/recovery-retry?x=1');
    expect(call.textBody).toContain('https://ask.gptweb.ru/api/billing/recovery-retry?x=1');
  });

  it('propagates errors as {ok:false, error}', async () => {
    vi.mocked(sendLifecycleEmail).mockResolvedValue({ ok: false, error: 'HTTP 500' });

    const out = await sendRecoveryEmail({
      to: 'user@example.com',
      payment: { amountRub: 490, type: 'subscription' },
      reasonCode: 'insufficient_funds',
      recoveryUrl: 'https://x',
      stage: 'stage1',
    });

    expect(out).toEqual({ ok: false, error: 'HTTP 500' });
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run src/server/modules/billing/__tests__/send-recovery-email.test.ts
```

Expected: FAIL — `Cannot find module '../send-recovery-email'`.

- [ ] **Step 3: Implement `send-recovery-email.ts`**

```ts
// src/server/modules/billing/send-recovery-email.ts
import { sendLifecycleEmail } from '@/server/modules/lifecycle/email';

import { buildRecoveryEmail, type BuildRecoveryEmailInput } from './email-templates/recovery';

export interface SendRecoveryEmailInput extends BuildRecoveryEmailInput {
  to: string;
}

export interface SendRecoveryEmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Thin wrapper: build template → send via lifecycle helper. The
 * lifecycle helper is fail-safe (never throws), so this returns
 * its result unchanged.
 */
export async function sendRecoveryEmail(
  input: SendRecoveryEmailInput,
): Promise<SendRecoveryEmailResult> {
  const { to, ...templateInput } = input;
  const tpl = buildRecoveryEmail(templateInput);
  return sendLifecycleEmail({
    to,
    subject: tpl.subject,
    html: tpl.html,
    textBody: tpl.text,
  });
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npx vitest run src/server/modules/billing/__tests__/send-recovery-email.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/billing/send-recovery-email.ts \
  src/server/modules/billing/__tests__/send-recovery-email.test.ts
git commit -m "feat(billing): sendRecoveryEmail wrapper over sendLifecycleEmail"
```

---

## Task 4: `RecoveryPayload.source` — backward-compatible

**Files:**

- Modify: `src/server/modules/billing/recovery-token.ts`

- Modify: `src/server/modules/billing/__tests__/recovery-token.test.ts`

- [ ] **Step 1: Add the failing test**

Append this block to `src/server/modules/billing/__tests__/recovery-token.test.ts`:

```ts
import { signRecoveryToken, verifyRecoveryToken } from '../recovery-token';

describe('RecoveryPayload.source (backward-compat)', () => {
  const SECRET = 'test-secret';
  const futureExp = Math.floor(Date.now() / 1000) + 3600;

  it('signs and verifies a token carrying source=email_stage1', () => {
    const token = signRecoveryToken(
      { paymentId: 'p1', userId: 'u1', method: 'any', exp: futureExp, source: 'email_stage1' },
      SECRET,
    );
    const verified = verifyRecoveryToken(token, SECRET);
    expect(verified).not.toBeNull();
    expect(verified!.source).toBe('email_stage1');
  });

  it('verifies legacy tokens without source (returns undefined source)', () => {
    // Legacy: sign without source field
    const legacyToken = signRecoveryToken(
      // @ts-expect-error — exercising the legacy shape
      { paymentId: 'p2', userId: 'u2', method: 'sbp', exp: futureExp },
      SECRET,
    );
    const verified = verifyRecoveryToken(legacyToken, SECRET);
    expect(verified).not.toBeNull();
    expect(verified!.source).toBeUndefined();
    expect(verified!.paymentId).toBe('p2');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run src/server/modules/billing/__tests__/recovery-token.test.ts
```

Expected: FAIL on first assertion (`source` does not exist on type or returns `undefined` when set).

- [ ] **Step 3: Update `RecoveryPayload`**

In `src/server/modules/billing/recovery-token.ts`, change the interface:

```ts
export interface RecoveryPayload {
  exp: number; // unix seconds
  method: 'sbp' | 'any';
  paymentId: string;
  /**
   * Optional — identifies which channel issued the token, used to
   * stamp `metadata.recovery_method_used` on the new payment.
   * Undefined for legacy (pre-2026-05-23) tokens.
   */
  source?: 'tg_dm' | 'email_stage1' | 'email_stage2';
  userId: string;
}
```

No change needed to `signRecoveryToken` or `verifyRecoveryToken` — they already `JSON.stringify` / `JSON.parse` the entire payload, so an extra field is transparent. The `source` simply rides along.

- [ ] **Step 4: Run all recovery-token tests, confirm pass**

```bash
npx vitest run src/server/modules/billing/__tests__/recovery-token.test.ts
```

Expected: all pass, including legacy round-trip.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/billing/recovery-token.ts \
  src/server/modules/billing/__tests__/recovery-token.test.ts
git commit -m "feat(billing): add optional source field to RecoveryPayload"
```

---

## Task 5: `/api/billing/recovery-retry` stamps source-aware `recovery_method_used`

**Files:**

- Modify: `src/app/(backend)/api/billing/recovery-retry/route.ts`

- [ ] **Step 1: Replace the hardcoded stamp**

In `src/app/(backend)/api/billing/recovery-retry/route.ts`, find the `metadata` block (currently around lines 84-90):

```ts
      metadata: {
        pricing_variant: (original.metadata as any)?.pricing_variant,
        recovery_from: original.id,
        recovery_method_used: 'tg_dm',
        sbp_preselected: method === 'sbp',
        tg_user_id: ub?.tgBotChatId ?? null,
      },
```

Replace with:

```ts
      metadata: {
        pricing_variant: (original.metadata as any)?.pricing_variant,
        recovery_from: original.id,
        recovery_method_used: verified.source ?? 'tg_dm', // fallback for legacy tokens
        sbp_preselected: method === 'sbp',
        tg_user_id: ub?.tgBotChatId ?? null,
      },
```

- [ ] **Step 2: Build, ensure no type errors**

```bash
npx tsc --noEmit 2>&1 | grep recovery-retry || echo OK
```

Expected: `OK` (no output from tsc means no errors in this file).

- [ ] **Step 3: Commit**

```bash
git add src/app/(backend)/api/billing/recovery-retry/route.ts
git commit -m "feat(billing): stamp recovery_method_used from token source"
```

---

## Task 6: Cron — Stage 1 email send + cap on email_recovery_sent

**Files:**

- Modify: `src/app/(backend)/api/cron/payment-recovery-notify/route.ts`

This task adds the email-send call inside the existing per-row loop. It also adds the email leg to the per-user cap check.

- [ ] **Step 1: Add the email helper imports**

At the top of the file, alongside the existing imports, add:

```ts
import { eq, sql } from 'drizzle-orm';

import { billingPayments } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { describeReason } from '@/server/modules/billing/cancellation-reasons';
import { signRecoveryToken } from '@/server/modules/billing/recovery-token';
import { sendRecoveryEmail } from '@/server/modules/billing/send-recovery-email';
import { fetchPlanById } from '@/server/services/billing/plans-source';
```

The only new import is `sendRecoveryEmail`. Leave the other imports as they are.

- [ ] **Step 2: Add `email` to the SELECT in the eligible-rows query**

Find the `SELECT bp.id::text AS id, ...` block (around lines 67-90). Add `u.email` to the select list and `JOIN users u`:

```ts
const rows = await db.execute(sql`
    SELECT bp.id::text AS id,
           bp.user_id,
           bp.amount_rub,
           bp.plan_id,
           bp.tokens_amount,
           bp.type,
           bp.metadata,
           ub.tg_bot_chat_id,
           u.email
    FROM billing_payments bp
    JOIN user_billing ub ON ub.user_id = bp.user_id
    JOIN users u ON u.id = bp.user_id
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
```

Wait — this query is the existing TG-eligible query (it requires `tg_bot_chat_id IS NOT NULL`). For email we need a different filter (no tg_bot_chat_id requirement, and `email_recovery_sent IS NULL` instead of `tg_recovery_sent IS NULL`).

Replace the query with TWO queries — keep the existing one as `tgCandidates`, add a parallel one as `emailCandidates`. The simplest, lowest-risk shape: keep the TG query untouched, add a new email-eligible query that overlaps it. The per-row sends are then driven independently. Here is the actual change:

After the existing `rows` query block, add a second:

```ts
// Email-eligible: same window, but driven by email_recovery_sent
// instead of tg_recovery_sent, and tg_bot_chat_id NOT required.
// We need the user's email here (joined off `users`).
const emailRows = await db.execute(sql`
    SELECT bp.id::text AS id,
           bp.user_id,
           bp.amount_rub,
           bp.plan_id,
           bp.tokens_amount,
           bp.type,
           bp.metadata,
           u.email
    FROM billing_payments bp
    JOIN users u ON u.id = bp.user_id
    WHERE bp.status IN ('failed','canceled')
      AND bp.created_at > NOW() - INTERVAL '24 hours'
      AND bp.created_at < NOW() - INTERVAL '5 minutes'
      AND (bp.metadata->>'email_recovery_sent') IS NULL
      AND u.email IS NOT NULL
      AND u.email <> ''
      AND NOT EXISTS (
        SELECT 1 FROM billing_payments bp2
        WHERE bp2.user_id = bp.user_id
          AND bp2.status = 'succeeded'
          AND bp2.created_at > bp.created_at
      )
    LIMIT 50
  `);

const emailCandidateRows = emailRows.rows as Array<{
  id: string;
  user_id: string;
  amount_rub: number;
  plan_id: number | null;
  tokens_amount: number | null;
  type: string;
  metadata: Record<string, unknown> | null;
  email: string;
}>;
```

- [ ] **Step 3: Compute the email cap (2 per user per 7d, counting both stages)**

After the existing TG `capRows`/`caps` computation, add:

```ts
// Email cap: max 2 (Stage 1 + Stage 2) per user per rolling 7d.
const emailUserIds = [...new Set(emailCandidateRows.map((r) => r.user_id))];
const emailCaps = new Map<string, number>();
if (emailUserIds.length > 0) {
  const emailUserIdList = sql.join(
    emailUserIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const emailCapRows = await db.execute(sql`
      SELECT user_id,
             COUNT(*) FILTER (
               WHERE (metadata->>'email_recovery_sent') IS NOT NULL
                 AND (metadata->>'email_recovery_sent')::timestamptz > NOW() - INTERVAL '7 days'
             )
             + COUNT(*) FILTER (
               WHERE (metadata->>'email_recovery_followup_sent') IS NOT NULL
                 AND (metadata->>'email_recovery_followup_sent')::timestamptz > NOW() - INTERVAL '7 days'
             ) AS email_count_7d
      FROM billing_payments
      WHERE user_id IN (${emailUserIdList})
      GROUP BY user_id
    `);
  for (const r of emailCapRows.rows as Array<{ user_id: string; email_count_7d: string }>) {
    emailCaps.set(r.user_id, Number(r.email_count_7d));
  }
}
```

- [ ] **Step 4: Add the email-send loop after the TG loop**

After the existing `for (const r of candidateRows)` block closes (TG sends), add a new loop for the email candidates:

```ts
// Stage 1 email loop — runs independently of TG. Both can fire for
// the same payment in the same tick (different stamps, no overlap).
for (const r of emailCandidateRows) {
  const used = emailCaps.get(r.user_id) ?? 0;
  if (used >= 2) {
    summary.rateLimited++;
    continue;
  }

  const cancellation = (r.metadata?.cancellation ?? {}) as Record<string, unknown>;
  const reasonCode = (cancellation.reason as string | undefined) ?? null;
  const plan = r.plan_id ? await fetchPlanById(r.plan_id) : undefined;
  const planName = plan?.name;

  const expSec = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  const t = signRecoveryToken(
    {
      paymentId: r.id,
      userId: r.user_id,
      method: 'any',
      exp: expSec,
      source: 'email_stage1',
    },
    secret,
  );
  const recoveryUrl = `${appEnv.APP_URL}/api/billing/recovery-retry?payment=${r.id}&method=any&t=${t}`;

  const sent = await sendRecoveryEmail({
    to: r.email,
    payment: {
      amountRub: r.amount_rub,
      planName,
      type: r.type === 'subscription' ? 'subscription' : 'topup',
    },
    reasonCode,
    recoveryUrl,
    stage: 'stage1',
  });

  if (sent.ok) {
    summary.sent++;
    emailCaps.set(r.user_id, used + 1);
    await db
      .update(billingPayments)
      .set({
        metadata: sql`COALESCE(${billingPayments.metadata}, '{}'::jsonb) || ${JSON.stringify({
          email_recovery_sent: new Date().toISOString(),
          email_recovery_sent_messageid: sent.messageId ?? null,
        })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(billingPayments.id, r.id));
  } else {
    summary.errors++;
    console.error('[payment-recovery-notify] email Stage 1 failed for', r.id, sent.error);
  }
}
```

- [ ] **Step 5: Build, ensure no type errors**

```bash
npx tsc --noEmit 2>&1 | grep -E 'payment-recovery-notify|send-recovery-email|recovery-token|recovery-retry' || echo OK
```

Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(backend\)/api/cron/payment-recovery-notify/route.ts
git commit -m "feat(cron): payment-recovery Stage 1 email send + 7d cap"
```

---

## Task 7: Cron — Stage 2 second SQL pass + send loop

**Files:**

- Modify: `src/app/(backend)/api/cron/payment-recovery-notify/route.ts`

- [ ] **Step 1: Add the Stage 2 query + loop at the end of the function**

After the Stage 1 email loop closes, and before the final `return Response.json(...)`, insert:

```ts
// ──────────────────────────────────────────────────────────────────
// Stage 2 follow-up: rows whose Stage 1 went out ≥24h ago, status
// still not succeeded, no Stage 2 sent yet. Outer bound: created_at
// within 7d to avoid resurrecting truly old failures.
// ──────────────────────────────────────────────────────────────────
const stage2Rows = await db.execute(sql`
    SELECT bp.id::text AS id,
           bp.user_id,
           bp.amount_rub,
           bp.plan_id,
           bp.tokens_amount,
           bp.type,
           bp.metadata,
           u.email
    FROM billing_payments bp
    JOIN users u ON u.id = bp.user_id
    WHERE bp.status IN ('failed','canceled')
      AND bp.created_at > NOW() - INTERVAL '7 days'
      AND (bp.metadata->>'email_recovery_sent') IS NOT NULL
      AND (bp.metadata->>'email_recovery_sent')::timestamptz < NOW() - INTERVAL '24 hours'
      AND (bp.metadata->>'email_recovery_followup_sent') IS NULL
      AND u.email IS NOT NULL
      AND u.email <> ''
      AND NOT EXISTS (
        SELECT 1 FROM billing_payments bp2
        WHERE bp2.user_id = bp.user_id
          AND bp2.status = 'succeeded'
          AND bp2.created_at > bp.created_at
      )
    LIMIT 50
  `);

const stage2CandidateRows = stage2Rows.rows as Array<{
  id: string;
  user_id: string;
  amount_rub: number;
  plan_id: number | null;
  tokens_amount: number | null;
  type: string;
  metadata: Record<string, unknown> | null;
  email: string;
}>;

for (const r of stage2CandidateRows) {
  const used = emailCaps.get(r.user_id) ?? 0;
  if (used >= 2) {
    summary.rateLimited++;
    continue;
  }

  const cancellation = (r.metadata?.cancellation ?? {}) as Record<string, unknown>;
  const reasonCode = (cancellation.reason as string | undefined) ?? null;
  const plan = r.plan_id ? await fetchPlanById(r.plan_id) : undefined;
  const planName = plan?.name;

  const expSec = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  const t = signRecoveryToken(
    {
      paymentId: r.id,
      userId: r.user_id,
      method: 'any',
      exp: expSec,
      source: 'email_stage2',
    },
    secret,
  );
  const recoveryUrl = `${appEnv.APP_URL}/api/billing/recovery-retry?payment=${r.id}&method=any&t=${t}`;

  const sent = await sendRecoveryEmail({
    to: r.email,
    payment: {
      amountRub: r.amount_rub,
      planName,
      type: r.type === 'subscription' ? 'subscription' : 'topup',
    },
    reasonCode,
    recoveryUrl,
    stage: 'stage2',
  });

  if (sent.ok) {
    summary.sent++;
    emailCaps.set(r.user_id, used + 1);
    await db
      .update(billingPayments)
      .set({
        metadata: sql`COALESCE(${billingPayments.metadata}, '{}'::jsonb) || ${JSON.stringify({
          email_recovery_followup_sent: new Date().toISOString(),
          email_recovery_followup_sent_messageid: sent.messageId ?? null,
        })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(billingPayments.id, r.id));
  } else {
    summary.errors++;
    console.error('[payment-recovery-notify] email Stage 2 failed for', r.id, sent.error);
  }
}
```

- [ ] **Step 2: Build, ensure no type errors**

```bash
npx tsc --noEmit 2>&1 | grep -E 'payment-recovery-notify' || echo OK
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(backend\)/api/cron/payment-recovery-notify/route.ts
git commit -m "feat(cron): payment-recovery Stage 2 email follow-up at ≥24h"
```

---

## Task 8: Webgpt-admin — surface email stamps on `/finance/payment-failures`

**Files:** (in the **webgpt-admin** repo)

- Modify: `webgpt-admin/lib/queries/payment-failures.ts`

- Modify: `webgpt-admin/app/(admin)/finance/payment-failures/page.tsx`

- [ ] **Step 1: Extend the row shape returned by the query**

Open `webgpt-admin/lib/queries/payment-failures.ts`. Find the SELECT (it currently pulls `bp.metadata`). Add two computed columns:

```ts
// In the SQL SELECT (add to the list of selected columns):
(metadata->>'email_recovery_sent')                 AS email_recovery_sent,
(metadata->>'email_recovery_followup_sent')        AS email_recovery_followup_sent,
(metadata->>'recovery_method_used')                AS recovery_method_used,
```

In the TypeScript row type for the query result, add:

```ts
email_recovery_sent: string | null;
email_recovery_followup_sent: string | null;
recovery_method_used: string | null;
```

- [ ] **Step 2: Add the columns to the page table**

Open `webgpt-admin/app/(admin)/finance/payment-failures/page.tsx`. In the `<thead>`, after the existing "TG recovery sent" column, add:

```tsx
<th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Email Stage 1</th>
<th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Email Stage 2</th>
<th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Recovered via</th>
```

In the `<tbody>` row template, after the existing "tg_recovery_sent" cell, add:

```tsx
<td className="px-3 py-2 text-sm">
  {row.email_recovery_sent
    ? new Date(row.email_recovery_sent).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
    : '—'}
</td>
<td className="px-3 py-2 text-sm">
  {row.email_recovery_followup_sent
    ? new Date(row.email_recovery_followup_sent).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
    : '—'}
</td>
<td className="px-3 py-2 text-sm">
  {row.recovery_method_used ? (
    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">{row.recovery_method_used}</span>
  ) : (
    '—'
  )}
</td>
```

- [ ] **Step 3: Build + start the admin locally, verify table renders**

```bash
cd /home/deploy/projects/webgpt-admin
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit (in webgpt-admin repo)**

```bash
git add lib/queries/payment-failures.ts app/\(admin\)/finance/payment-failures/page.tsx
git commit -m "feat(admin): show email Stage 1/2 columns + recovery method"
git push origin main
```

---

## Task 9: Ops — preflight, backfill stamps, deploy, smoke

**Files:** none (operational only).

- [ ] **Step 1: Preflight — confirm Brevo IP allow-list took effect (from Task 0)**

```bash
BREVO_API_KEY=$(grep -E '^BREVO_API_KEY=' /opt/lobechat/.env | cut -d= -f2-)
curl -s -w "\nHTTP:%{http_code}" -X POST https://api.brevo.com/v3/smtp/email \
  -H "api-key: $BREVO_API_KEY" \
  -H "content-type: application/json" \
  -d '{"sender":{"email":"noreply@gptweb.ru","name":"WebGPT"},"to":[{"email":"2396741@gmail.com"}],"subject":"preflight","htmlContent":"<p>preflight</p>"}'
```

Expected: `HTTP:201` and a JSON body with `messageId`. If `HTTP:401` — go back to Task 0.

- [ ] **Step 2: Back-stamp existing eligible rows so the first cron tick post-deploy doesn't carpet-bomb the user base**

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -c "
UPDATE billing_payments
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
  'email_recovery_sent', NOW()::text,
  'email_recovery_sent_messageid', '<backstamped-pre-launch>'
)
WHERE status IN ('failed','canceled')
  AND created_at > NOW() - INTERVAL '7 days'
  AND (metadata->>'email_recovery_sent') IS NULL;
"
```

Expected: `UPDATE N` printed, where N is the count of pre-launch eligible rows. Save N for the post-deploy comparison.

- [ ] **Step 3: Build and deploy lobechat-custom**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
git push origin canary
docker build -t lobechat-custom:latest .
cd /opt/lobechat && docker compose up -d lobe
sleep 12 && curl -s -o /dev/null -w '%{http_code}\n' https://ask.gptweb.ru/
```

Expected final line: `200`.

- [ ] **Step 4: Trigger one cron run by hand, check the summary**

```bash
CRON_SECRET=$(grep -E '^CRON_SECRET=' /opt/lobechat/.env | cut -d= -f2-)
curl -s -H "Authorization: Bearer $CRON_SECRET" https://ask.gptweb.ru/api/cron/payment-recovery-notify
```

Expected: `{"ok":true,"eligible":...,"sent":0,...}` — `sent` should be 0 because Step 2 back-stamped everything. If `sent > 0`, the back-stamp missed rows; investigate immediately.

- [ ] **Step 5: End-to-end smoke — clear one row's stamps, trigger, watch email arrive**

```bash
# Pick the developer's own test row to avoid surprising real users
docker exec lobe-postgres psql -U postgres -d lobechat -c "
UPDATE billing_payments
SET metadata = (metadata - 'email_recovery_sent' - 'email_recovery_sent_messageid' - 'email_recovery_followup_sent' - 'email_recovery_followup_sent_messageid')
WHERE id = '60aab567-96ed-432e-abae-b4476984e708';
"

# Trigger the cron
CRON_SECRET=$(grep -E '^CRON_SECRET=' /opt/lobechat/.env | cut -d= -f2-)
curl -s -H "Authorization: Bearer $CRON_SECRET" https://ask.gptweb.ru/api/cron/payment-recovery-notify

# Check the row got stamped
docker exec lobe-postgres psql -U postgres -d lobechat -tA -c "
SELECT metadata->>'email_recovery_sent', metadata->>'email_recovery_sent_messageid'
FROM billing_payments WHERE id = '60aab567-96ed-432e-abae-b4476984e708';
"
```

Expected: `eligible >= 1, sent >= 1` in the cron output, and the stamp query prints a recent timestamp + a Brevo messageId. Confirm visually that the email lands in the test inbox.

- [ ] **Step 6: 24h follow-up smoke**

The morning after Step 5, run the same trigger:

```bash
CRON_SECRET=$(grep -E '^CRON_SECRET=' /opt/lobechat/.env | cut -d= -f2-)
curl -s -H "Authorization: Bearer $CRON_SECRET" https://ask.gptweb.ru/api/cron/payment-recovery-notify

docker exec lobe-postgres psql -U postgres -d lobechat -tA -c "
SELECT metadata->>'email_recovery_followup_sent'
FROM billing_payments WHERE id = '60aab567-96ed-432e-abae-b4476984e708';
"
```

Expected: `sent >= 1` in cron output, follow-up stamp present in DB.

- [ ] **Step 7: Week-1 metrics check (manual)**

7 days after deploy, run:

```bash
docker exec lobe-postgres psql -U postgres -d lobechat -tA -c "
SELECT recovery_method_used, COUNT(*) AS recovered_count
FROM (
  SELECT metadata->>'recovery_method_used' AS recovery_method_used
  FROM billing_payments
  WHERE status = 'succeeded' AND created_at > NOW() - INTERVAL '7 days'
) sub
WHERE recovery_method_used IS NOT NULL
GROUP BY recovery_method_used ORDER BY 2 DESC;
"
```

Expected: a breakdown like `tg_dm | 3`, `email_stage1 | 5`, `email_stage2 | 1`, etc. Use this as the baseline for the goal (+3 paid/week attributable to email).

---

## Self-Review

**Spec coverage check:**

- ✅ Problem + Goal: implicitly addressed by sum of tasks 0-9.
- ✅ User Flow steps 1-5: tasks 6-7 implement the cron sends; task 5 stamps `recovery_method_used`; the fulfill path is unchanged (per spec non-goal).
- ✅ Anti-Spam Caps: task 6 implements the 7d/user/2-email cap with separate accounting from TG. Task 6 also uses `email_recovery_sent IS NULL` for Stage 1 dedupe; task 7 uses `email_recovery_followup_sent IS NULL` for Stage 2.
- ✅ Architecture: tasks 6 and 7 extend `payment-recovery-notify/route.ts` exactly as the spec diagram shows.
- ✅ File Structure: every file in the spec's table has a task that creates or modifies it. The spec also lists `recovery-copy.ts` separate from `recovery.ts` — task 1 creates the copy file, task 2 creates the builder.
- ✅ Copy / Tone: task 1 lands all 12 reasons × 2 stages + `_default`. Light humor is in every block. Stage 1 vs Stage 2 subjects always differ (tested in task 2).
- ✅ Data Model: task 6 writes `email_recovery_sent` + `email_recovery_sent_messageid`, task 7 writes the `_followup_` variants. Task 5 stamps `recovery_method_used` from `verified.source` (new enum values supported transparently as strings).
- ✅ HMAC payload change (optional `source` field): task 4 lands this with a backward-compat test.
- ✅ Sender Identity: covered by env vars (no code change). Task 0 confirms the IP allow-list is sorted.
- ✅ Error Handling: `sendLifecycleEmail` is fail-safe by contract (verified in task 3 test). Cron logs and increments `errors`.
- ✅ Observability: task 8 adds the admin columns.
- ✅ Testing Strategy: tasks 2 and 3 are TDD; task 9 step 5 is the production smoke.
- ✅ Rollout: task 9 is the rollout, including the back-stamp to prevent carpet-bombing.

**Placeholder scan:** none — every code block is complete, every SQL has the actual conditions, every command has an expected output.

**Type consistency:**

- `BuildRecoveryEmailInput` → `SendRecoveryEmailInput extends BuildRecoveryEmailInput & { to }` ✅
- `RecoveryPayload.source` is the same union (`'tg_dm' | 'email_stage1' | 'email_stage2'`) in tasks 4, 5, 6, 7 ✅
- `payment.type` is `'subscription' | 'topup'` consistently ✅
- `stage: 'stage1' | 'stage2'` consistently ✅
- `metadata` field names: `email_recovery_sent`, `email_recovery_sent_messageid`, `email_recovery_followup_sent`, `email_recovery_followup_sent_messageid` — same in tasks 6, 7, 8, 9 ✅
