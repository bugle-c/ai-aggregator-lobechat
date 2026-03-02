# WebGPT Credit System & Upsell Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace token-based billing with credit-based system and add 4 upsell touchpoints (sidebar widget, low-balance warning, exhaustion modal, welcome screen).

**Architecture:** Keep existing DB columns (token_limit, token_balance, etc.) but store credits instead of tokens. Add conversion layer (tokens → credits) in usage tracking. Build 3 new UI components + redesign 3 existing ones.

**Tech Stack:** React 19, antd, @lobehub/ui, tRPC, Drizzle ORM, react-i18next

---

### Task 1: Update billing constants — plans and topups

**Files:**

- Modify: `src/server/modules/billing/constants.ts`

**Step 1: Update constants file**

Replace the entire file content:

```typescript
// Credit conversion: 1 credit ≈ 1 standard message ≈ 2500 tokens
export const TOKENS_PER_CREDIT = 2500;

// Credit costs by action type
export const CREDIT_COSTS = {
  text: 1, // standard text message
  image: 10, // image generation (DALL-E)
  video: 30, // video generation
  reasoning: 3, // heavy reasoning models (o1, etc.)
} as const;

export const TOPUP_PACKAGES = [
  { amountRub: 149, credits: 200, label: '200 кредитов' },
  { amountRub: 599, credits: 1000, label: '1 000 кредитов' },
  { amountRub: 2499, credits: 5000, label: '5 000 кредитов' },
] as const;

export type TopupPackage = (typeof TOPUP_PACKAGES)[number];

export function getTopupPackage(amountRub: number): TopupPackage | undefined {
  return TOPUP_PACKAGES.find((p) => p.amountRub === amountRub);
}

// Convert raw token usage to credits consumed
export function tokensToCredits(tokens: number): number {
  return Math.max(1, Math.ceil(tokens / TOKENS_PER_CREDIT));
}
```

**Step 2: Verify imports still work**

Run: `cd /home/deploy/projects/ai-aggregator-lobechat && grep -r "from.*billing/constants" src/ --include="*.ts" --include="*.tsx"`

Check that all importers reference valid exports. The old `tokens` field on TOPUP_PACKAGES is gone — importers need updating.

**Step 3: Commit**

```bash
git add src/server/modules/billing/constants.ts
git commit -m "feat(billing): update constants to credit-based system"
```

---

### Task 2: Update usage tracking — tokens to credits conversion

**Files:**

- Modify: `src/server/modules/billing/checkUsageLimit.ts`

**Step 1: Update checkUsageLimit and recordTokenUsage**

```typescript
import { type LobeChatDatabase } from '@/database/type';
import { BillingService } from '@/server/services/billing';

import { tokensToCredits } from './constants';

export interface UsageLimitResult {
  allowed: boolean;
  creditsRemaining?: number;
  message?: string;
}

export async function checkUsageLimit(
  db: LobeChatDatabase,
  userId: string,
): Promise<UsageLimitResult> {
  try {
    const billingService = new BillingService(db, userId);
    const billing = await billingService.getOrResetUserBilling();
    const plan = await billingService.getPlanById(billing.planId);
    const creditLimit = plan?.tokenLimit || 50;
    const totalAvailable = creditLimit + billing.tokenBalance;

    if (billing.tokensUsedMonth >= totalAvailable) {
      return {
        allowed: false,
        creditsRemaining: 0,
        message: 'Кредиты закончились. Пополните баланс или обновите план.',
      };
    }

    return {
      allowed: true,
      creditsRemaining: totalAvailable - billing.tokensUsedMonth,
    };
  } catch (error) {
    console.error('[billing] checkUsageLimit error:', error);
    return { allowed: true }; // fail-open
  }
}

export async function recordTokenUsage(
  db: LobeChatDatabase,
  userId: string,
  tokensUsed: number,
): Promise<void> {
  if (tokensUsed <= 0) return;
  try {
    const credits = tokensToCredits(tokensUsed);
    const billingService = new BillingService(db, userId);
    await billingService.incrementTokensUsed(credits);
  } catch (error) {
    console.error('[billing] recordTokenUsage error:', error);
  }
}
```

Note: `remainingTokens` renamed to `creditsRemaining`. Check for callers that reference the old field name.

**Step 2: Find and update callers of `remainingTokens`**

Run: `grep -r "remainingTokens" src/ --include="*.ts" --include="*.tsx"`

Update any references to use `creditsRemaining`.

**Step 3: Commit**

```bash
git add src/server/modules/billing/checkUsageLimit.ts
git commit -m "feat(billing): convert usage tracking to credits"
```

---

### Task 3: Update topUp router for credit packages

**Files:**

- Modify: `src/business/server/lambda-routers/topUp.ts`

**Step 1: Read current file**

Read `src/business/server/lambda-routers/topUp.ts` to see current implementation.

**Step 2: Update to use `credits` instead of `tokens`**

The router validates the package by `amountRub` and returns the package. The `createPayment` mutation stores `tokensAmount` in the payment record — now this should store credits.

Key change: where it writes `tokensAmount: pkg.tokens`, change to `tokensAmount: pkg.credits` (the DB column name stays, but the value is now credits).

**Step 3: Commit**

```bash
git add src/business/server/lambda-routers/topUp.ts
git commit -m "feat(billing): update topup router for credits"
```

---

### Task 4: Update spend router — add getCreditState endpoint

**Files:**

- Modify: `src/business/server/lambda-routers/spend.ts`

**Step 1: Add getCreditState query**

Add a new query alongside `getUsageSummary` (keep old one for backwards compat):

```typescript
getCreditState: billingProcedure.query(async ({ ctx }) => {
  const billing = await ctx.billingService.getOrResetUserBilling();
  const plan = await ctx.billingService.getPlanById(billing.planId);
  const plans = await ctx.billingService.getActivePlans();

  const creditLimit = plan?.tokenLimit || 50;
  const totalAvailable = creditLimit + billing.tokenBalance;
  const usagePercent =
    totalAvailable > 0 ? Math.round((billing.tokensUsedMonth / totalAvailable) * 100) : 0;

  // Calculate days until monthly reset
  const now = new Date();
  const nextMonthStart = new Date(billing.monthStart);
  nextMonthStart.setMonth(nextMonthStart.getMonth() + 1);
  const daysUntilReset = Math.max(
    0,
    Math.ceil((nextMonthStart.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
  );

  // Find next upgrade plan
  const currentPlanPrice = plan?.priceRub || 0;
  const nextPlan = plans.find((p) => p.priceRub > currentPlanPrice);

  return {
    creditBalance: billing.tokenBalance,
    creditLimit,
    creditsUsed: billing.tokensUsedMonth,
    daysUntilReset,
    nextPlanCredits: nextPlan?.tokenLimit,
    nextPlanName: nextPlan?.name,
    nextPlanPrice: nextPlan?.priceRub,
    planName: plan?.name || 'Старт',
    planSlug: plan?.slug || 'free',
    totalAvailable,
    usagePercent: Math.min(usagePercent, 100),
  };
}),
```

**Step 2: Also update getUsageSummary to use credit terminology**

Change `tokenLimit`, `tokenBalance`, `tokensUsedMonth` in the return to `creditLimit`, `creditBalance`, `creditsUsedMonth` (or keep both for backwards compat).

**Step 3: Commit**

```bash
git add src/business/server/lambda-routers/spend.ts
git commit -m "feat(billing): add getCreditState endpoint"
```

---

### Task 5: Update subscription router for credit plans

**Files:**

- Modify: `src/business/server/lambda-routers/subscription.ts`

**Step 1: Read current file**

Read `src/business/server/lambda-routers/subscription.ts`.

**Step 2: Update getBillingState response**

The response should return credit-based fields:

- `tokenLimit` → `creditLimit`
- `tokenBalance` → `creditBalance`
- `tokensUsedMonth` → `creditsUsed`

Keep `plan`, `subscriptionExpiresAt`.

**Step 3: Update getPlans response**

Plan items should include `creditLimit` (mapped from `tokenLimit` column).

**Step 4: Commit**

```bash
git add src/business/server/lambda-routers/subscription.ts
git commit -m "feat(billing): update subscription router for credits"
```

---

### Task 6: Update fulfillment logic for credits

**Files:**

- Modify: `src/server/modules/billing/fulfill.ts`

**Step 1: Read current file**

Read `src/server/modules/billing/fulfill.ts`.

**Step 2: Update log messages**

Change "tokens" to "credits" in log messages. The actual logic doesn't change since we're keeping column names but storing credits.

**Step 3: Commit**

```bash
git add src/server/modules/billing/fulfill.ts
git commit -m "refactor(billing): update fulfillment logs for credits"
```

---

### Task 7: Create CreditWidget sidebar component

**Files:**

- Create: `src/components/CreditWidget/index.tsx`
- Create: `src/components/CreditWidget/CreditWidget.tsx`

**Step 1: Create CreditWidget component**

`src/components/CreditWidget/CreditWidget.tsx`:

```tsx
'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Progress, Typography } from 'antd';
import { Zap } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { lambdaQuery } from '@/libs/trpc/client';

const { Text } = Typography;

const CreditWidget = memo(() => {
  const { t } = useTranslation('subscription');
  const navigate = useNavigate();

  const { data, isLoading } = lambdaQuery.spend.getCreditState.useQuery(undefined, {
    refetchInterval: 60_000, // refresh every minute
  });

  if (isLoading || !data) return null;

  const { planName, creditsUsed, totalAvailable, usagePercent, planSlug } = data;
  const remaining = Math.max(0, totalAvailable - creditsUsed);

  const strokeColor = usagePercent > 90 ? '#ff4d4f' : usagePercent > 70 ? '#faad14' : '#1677ff';

  return (
    <Flexbox
      gap={4}
      padding={'8px 12px'}
      style={{
        borderRadius: 8,
        borderTop: '1px solid var(--lobe-color-border)',
        cursor: 'pointer',
      }}
      onClick={() => navigate('/settings/subscription/plans')}
    >
      <Flexbox horizontal align="center" gap={6} justify="space-between">
        <Flexbox horizontal align="center" gap={4}>
          <Icon icon={Zap} size={14} />
          <Text style={{ fontSize: 12 }} type="secondary">
            {planName}
          </Text>
        </Flexbox>
        <Text style={{ fontSize: 12 }} type="secondary">
          {remaining} / {totalAvailable}
        </Text>
      </Flexbox>
      <Progress percent={usagePercent} showInfo={false} size="small" strokeColor={strokeColor} />
      {planSlug !== 'pro' && (
        <Text style={{ fontSize: 11 }} type="secondary">
          {t('widget.upgrade')}
        </Text>
      )}
    </Flexbox>
  );
});

CreditWidget.displayName = 'CreditWidget';
export default CreditWidget;
```

`src/components/CreditWidget/index.tsx`:

```tsx
export { default } from './CreditWidget';
```

**Step 2: Integrate CreditWidget into sidebar**

Modify: `src/features/NavPanel/SideBarLayout.tsx`

Add CreditWidget between the scrollable body and the footer:

```tsx
import { Flexbox, ScrollShadow, TooltipGroup } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { memo, Suspense } from 'react';

import Footer from '@/app/[variants]/(main)/home/_layout/Footer';
import CreditWidget from '@/components/CreditWidget';
import SkeletonList, { SkeletonItem } from '@/features/NavPanel/components/SkeletonList';

interface SidebarLayoutProps {
  body?: ReactNode;
  footer?: ReactNode;
  header?: ReactNode;
}

const SideBarLayout = memo<SidebarLayoutProps>(({ header, body, footer }) => {
  return (
    <Flexbox gap={4} style={{ height: '100%', overflow: 'hidden' }}>
      <Suspense fallback={<SkeletonItem height={44} style={{ marginTop: 8 }} />}>{header}</Suspense>
      <ScrollShadow size={2} style={{ height: '100%' }}>
        <TooltipGroup>
          <Suspense fallback={<SkeletonList paddingBlock={8} />}>{body}</Suspense>
        </TooltipGroup>
      </ScrollShadow>
      <Suspense>
        <CreditWidget />
      </Suspense>
      <Suspense>{footer || <Footer />}</Suspense>
    </Flexbox>
  );
});

export default SideBarLayout;
```

**Step 3: Commit**

```bash
git add src/components/CreditWidget/ src/features/NavPanel/SideBarLayout.tsx
git commit -m "feat(billing): add CreditWidget to sidebar"
```

---

### Task 8: Create LowBalanceWarning banner component

**Files:**

- Create: `src/components/LowBalanceWarning/index.tsx`
- Create: `src/components/LowBalanceWarning/LowBalanceWarning.tsx`

**Step 1: Create the component**

`src/components/LowBalanceWarning/LowBalanceWarning.tsx`:

```tsx
'use client';

import { Alert, Flexbox } from '@lobehub/ui';
import { Button } from 'antd';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { lambdaQuery } from '@/libs/trpc/client';

const LowBalanceWarning = memo(() => {
  const { t } = useTranslation('subscription');
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const [dismissCount, setDismissCount] = useState(0);

  const { data } = lambdaQuery.spend.getCreditState.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    setDismissCount((c) => c + 1);
  }, []);

  // Re-show after 5 dismiss cycles (simulating "after 5 messages")
  // In practice, the component re-mounts on new messages
  if (!data) return null;

  const { creditsUsed, totalAvailable, usagePercent } = data;
  const remaining = totalAvailable - creditsUsed;

  // Only show when <20% remaining and credits > 0 (not exhausted — modal handles that)
  if (usagePercent < 80 || remaining <= 0 || dismissed) return null;

  return (
    <Flexbox paddingBlock={'0 6px'} paddingInline={12}>
      <Alert
        closable
        extra={
          <Flexbox horizontal gap={8} style={{ marginTop: 8 }}>
            <Button size="small" onClick={() => navigate('/settings/subscription/funds')}>
              {t('warning.topup')}
            </Button>
            <Button
              size="small"
              type="primary"
              onClick={() => navigate('/settings/subscription/plans')}
            >
              {t('warning.upgrade')}
            </Button>
          </Flexbox>
        }
        title={t('warning.lowBalance', { remaining })}
        type={'warning'}
        onClose={handleDismiss}
      />
    </Flexbox>
  );
});

LowBalanceWarning.displayName = 'LowBalanceWarning';
export default LowBalanceWarning;
```

`src/components/LowBalanceWarning/index.tsx`:

```tsx
export { default } from './LowBalanceWarning';
```

**Step 2: Integrate into ChatInput**

Modify: `src/features/Conversation/ChatInput/index.tsx`

Add the warning banner above the error alert, inside the `defaultContent`:

```tsx
import LowBalanceWarning from '@/components/LowBalanceWarning';

// Inside defaultContent, before the error alert:
const defaultContent = (
  <WideScreenContainer style={skipScrollMarginWithList ? { marginTop: -12 } : undefined}>
    <LowBalanceWarning />
    {sendMessageErrorMsg && (
      <Flexbox paddingBlock={'0 6px'} paddingInline={12}>
        <Alert
          closable
          title={t('input.errorMsg', { errorMsg: sendMessageErrorMsg })}
          type={'secondary'}
          onClose={clearSendMessageError}
        />
      </Flexbox>
    )}
    <DesktopChatInput
      actionBarStyle={actionBarStyle}
      borderRadius={12}
      extraActionItems={extraActionItems}
      leftContent={leftContent}
      sendAreaPrefix={sendAreaPrefix}
    />
  </WideScreenContainer>
);
```

**Step 3: Commit**

```bash
git add src/components/LowBalanceWarning/ src/features/Conversation/ChatInput/index.tsx
git commit -m "feat(billing): add LowBalanceWarning banner above chat input"
```

---

### Task 9: Create CreditsExhaustedModal component

**Files:**

- Create: `src/components/CreditsExhaustedModal/index.tsx`
- Create: `src/components/CreditsExhaustedModal/CreditsExhaustedModal.tsx`

**Step 1: Create the modal**

`src/components/CreditsExhaustedModal/CreditsExhaustedModal.tsx`:

```tsx
'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Card, Modal, Typography } from 'antd';
import { Zap } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';

const { Text, Title } = Typography;

interface CreditsExhaustedModalProps {
  onClose: () => void;
  open: boolean;
}

const CreditsExhaustedModal = memo<CreditsExhaustedModalProps>(({ open, onClose }) => {
  const { t } = useTranslation('subscription');

  const { data } = lambdaQuery.spend.getCreditState.useQuery();
  const { data: plans } = lambdaQuery.subscription.getPlans.useQuery();
  const { data: packages } = lambdaQuery.topUp.getPackages.useQuery();

  const subscribeMutation = lambdaQuery.subscription.createPayment.useMutation({
    onSuccess: (data) => {
      if (data.paymentUrl) window.location.href = data.paymentUrl;
    },
  });

  const topUpMutation = lambdaQuery.topUp.createPayment.useMutation({
    onSuccess: (data) => {
      if (data.paymentUrl) window.location.href = data.paymentUrl;
    },
  });

  if (!data || !plans) return null;

  const { planName, daysUntilReset, creditLimit } = data;

  // Filter to paid plans only (for upgrade cards)
  const upgradePlans = plans.filter((p) => p.priceRub > 0);
  const cheapestTopup = packages?.[0];

  return (
    <Modal
      centered
      footer={null}
      open={open}
      title={
        <Flexbox horizontal align="center" gap={8}>
          <Icon icon={Zap} />
          {t('modal.exhausted.title')}
        </Flexbox>
      }
      width={480}
      onCancel={onClose}
    >
      <Flexbox gap={16}>
        <Text>{t('modal.exhausted.desc', { credits: creditLimit, plan: planName })}</Text>
        <Text type="secondary">{t('modal.exhausted.resetIn', { days: daysUntilReset })}</Text>

        {/* Upgrade plan cards */}
        <Flexbox horizontal gap={12}>
          {upgradePlans.map((plan) => (
            <Card key={plan.id} size="small" style={{ flex: 1, textAlign: 'center' }}>
              <Flexbox align="center" gap={8}>
                <Title level={5} style={{ margin: 0 }}>
                  {plan.name}
                </Title>
                <Text style={{ fontSize: 18 }}>{plan.priceRub} ₽/мес</Text>
                <Text type="secondary">{plan.tokenLimit} кредитов</Text>
                <Button
                  block
                  loading={subscribeMutation.isPending}
                  type="primary"
                  onClick={() => subscribeMutation.mutate({ planId: plan.id })}
                >
                  {t('modal.exhausted.select')}
                </Button>
              </Flexbox>
            </Card>
          ))}
        </Flexbox>

        {/* Quick topup */}
        {cheapestTopup && (
          <Button
            block
            loading={topUpMutation.isPending}
            onClick={() => topUpMutation.mutate({ amountRub: cheapestTopup.amountRub })}
          >
            {t('modal.exhausted.topup', { price: cheapestTopup.amountRub })}
          </Button>
        )}
      </Flexbox>
    </Modal>
  );
});

CreditsExhaustedModal.displayName = 'CreditsExhaustedModal';
export default CreditsExhaustedModal;
```

`src/components/CreditsExhaustedModal/index.tsx`:

```tsx
export { default } from './CreditsExhaustedModal';
```

**Step 2: Integrate into chat send flow**

The modal should appear when the user tries to send a message and `checkUsageLimit` returns `allowed: false`.

Modify: `src/features/Conversation/ChatInput/index.tsx`

Add state for the modal and trigger it when send fails due to credits:

```tsx
import { useState } from 'react';
import CreditsExhaustedModal from '@/components/CreditsExhaustedModal';

// Inside the component, add state:
const [showExhaustedModal, setShowExhaustedModal] = useState(false);

// In the handleSend callback, check if the send error is about credits:
// The existing error handling via sendMessageErrorMsg will catch this.
// We can show the modal when sendMessageErrorMsg contains credit-related text.

// In the JSX, add the modal:
// After the ChatInputProvider closing tag:
<CreditsExhaustedModal open={showExhaustedModal} onClose={() => setShowExhaustedModal(false)} />;
```

Alternatively, create a wrapper hook `useCreditExhaustedModal` that listens to the billing state and shows the modal automatically when credits hit 0 during a send attempt. The exact integration depends on how the error propagates from the backend.

**Step 3: Commit**

```bash
git add src/components/CreditsExhaustedModal/ src/features/Conversation/ChatInput/index.tsx
git commit -m "feat(billing): add CreditsExhaustedModal on limit hit"
```

---

### Task 10: Add credit info to Welcome screen

**Files:**

- Modify: `src/app/[variants]/(main)/agent/features/Conversation/AgentWelcome/index.tsx`

**Step 1: Add credit usage display**

Import the credit state query and display a compact usage card:

```tsx
import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Progress, Typography } from 'antd';
import { Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { lambdaQuery } from '@/libs/trpc/client';

// Inside InboxWelcome component, add a credit info section:
const { data: creditState } = lambdaQuery.spend.getCreditState.useQuery();
const navigate = useNavigate();

// In the JSX, after the Markdown welcome message and before OpeningQuestions:
{
  creditState && (
    <Flexbox
      gap={8}
      padding={16}
      style={{
        background: 'var(--lobe-color-fill-secondary)',
        borderRadius: 12,
        maxWidth: 400,
      }}
    >
      <Flexbox horizontal align="center" gap={6} justify="space-between">
        <Flexbox horizontal align="center" gap={4}>
          <Icon icon={Zap} size={14} />
          <Typography.Text style={{ fontSize: 13 }}>
            {creditState.planName}: {creditState.totalAvailable - creditState.creditsUsed} /{' '}
            {creditState.totalAvailable} кредитов
          </Typography.Text>
        </Flexbox>
      </Flexbox>
      <Progress
        percent={creditState.usagePercent}
        showInfo={false}
        size="small"
        strokeColor={
          creditState.usagePercent > 90
            ? '#ff4d4f'
            : creditState.usagePercent > 70
              ? '#faad14'
              : '#1677ff'
        }
      />
      {creditState.nextPlanName && (
        <Flexbox horizontal align="center" gap={8}>
          <Typography.Text style={{ fontSize: 12 }} type="secondary">
            Перейдите на {creditState.nextPlanName} за {creditState.nextPlanPrice} ₽ и получите{' '}
            {creditState.nextPlanCredits} кредитов/мес
          </Typography.Text>
          <Button size="small" onClick={() => navigate('/settings/subscription/plans')}>
            Подробнее
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
}
```

**Step 2: Commit**

```bash
git add src/app/[variants]/(main)/agent/features/Conversation/AgentWelcome/index.tsx
git commit -m "feat(billing): add credit info to welcome screen"
```

---

### Task 11: Redesign Plans settings page

**Files:**

- Modify: `src/business/client/BusinessSettingPages/Plans.tsx`

**Step 1: Rewrite Plans page with comparison layout**

The new Plans page should:

- Show 3 plan cards in a row with "Популярный" badge on Standard
- Each card: name, price, credits/month, "\~X сообщений" hint, feature list, CTA button
- Top-up packages section below
- Current plan highlighted with border + "Текущий" badge

See design doc for layout reference. Use antd `Card`, `Tag`, `Button`, `Grid` components.

Key changes from current:

- Replace `formatTokens()` with simple credit numbers
- Add "\~X сообщений" hint next to credit count
- Add "Популярный" tag to Standard plan
- Add feature comparison (all models, priority access, early access)
- Current plan gets green border + "Текущий" tag

**Step 2: Commit**

```bash
git add src/business/client/BusinessSettingPages/Plans.tsx
git commit -m "feat(billing): redesign Plans page with credit comparison"
```

---

### Task 12: Update Usage settings page

**Files:**

- Modify: `src/business/client/BusinessSettingPages/Usage.tsx`

**Step 1: Update to use credit terminology**

Replace all "токенов" references with "кредитов":

- `formatTokens()` → just display numbers directly (credits are small numbers, no need for K/M formatting)
- Update Statistic titles from token-based to credit-based
- Update query to use `getCreditState` or updated `getUsageSummary`

**Step 2: Commit**

```bash
git add src/business/client/BusinessSettingPages/Usage.tsx
git commit -m "feat(billing): update Usage page for credits"
```

---

### Task 13: Update Funds settings page

**Files:**

- Modify: `src/business/client/BusinessSettingPages/Funds.tsx`

**Step 1: Update to use credit terminology**

- Update `formatTokens()` to display credit numbers
- Update Statistic titles
- Top-up packages now show "кредитов" instead of "токенов"

**Step 2: Commit**

```bash
git add src/business/client/BusinessSettingPages/Funds.tsx
git commit -m "feat(billing): update Funds page for credits"
```

---

### Task 14: Add i18n keys for new components

**Files:**

- Modify: `src/locales/default/subscription.ts`

**Step 1: Add new keys**

Add these keys to the subscription namespace:

```typescript
// Credit widget
'widget.upgrade': 'Улучшить план →',

// Low balance warning
'warning.lowBalance': 'Осталось {{remaining}} кредитов',
'warning.topup': 'Пополнить',
'warning.upgrade': 'Улучшить план',

// Credits exhausted modal
'modal.exhausted.title': 'Кредиты закончились',
'modal.exhausted.desc': 'Ваш план {{plan}}: {{credits}} кредитов/мес',
'modal.exhausted.resetIn': 'Кредиты обновятся через {{days}} дн.',
'modal.exhausted.select': 'Выбрать',
'modal.exhausted.topup': 'Пополнить от {{price}} ₽',

// Updated plan labels
'plans.credits': '{{count}} кредитов/мес',
'plans.creditsHint': '~{{count}} сообщений',
'plans.popular': 'Популярный',
```

**Step 2: Commit**

```bash
git add src/locales/default/subscription.ts
git commit -m "feat(i18n): add credit system locale keys"
```

---

### Task 15: Update billing_plans seed data in database

**Files:**

- No Drizzle migration needed (column names stay the same)
- SQL script to update plan values

**Step 1: Update plan data directly via SQL**

Connect to Supabase and run:

```sql
-- Update plan credit limits (stored in token_limit column, now representing credits)
UPDATE billing_plans SET token_limit = 50 WHERE slug = 'free';
UPDATE billing_plans SET token_limit = 1000 WHERE slug = 'basic';
UPDATE billing_plans SET token_limit = 10000 WHERE slug = 'pro';

-- Update plan names to Russian
UPDATE billing_plans SET name = 'Старт' WHERE slug = 'free';
UPDATE billing_plans SET name = 'Стандарт' WHERE slug = 'basic';
UPDATE billing_plans SET name = 'Про' WHERE slug = 'pro';
```

**Step 2: Reset existing users' usage counters**

Since we're changing the unit from tokens to credits, existing usage data would be misleadingly high. Reset for all users:

```sql
-- Reset all users' monthly usage (they'll start fresh with credit counting)
UPDATE user_billing SET tokens_used_month = 0;

-- Convert existing token balances to credit equivalents
-- Old: tokens, New: credits (1 credit = 2500 tokens)
UPDATE user_billing SET token_balance = GREATEST(1, CEIL(token_balance::numeric / 2500)) WHERE token_balance > 0;
```

**Step 3: Verify**

```sql
SELECT * FROM billing_plans ORDER BY price_rub;
SELECT COUNT(*), AVG(token_balance) FROM user_billing;
```

**Step 4: Commit plan update note**

No code commit needed for SQL, but update KNOWLEDGE.md.

---

### Task 16: Build and verify

**Step 1: Run type-check**

```bash
cd /home/deploy/projects/ai-aggregator-lobechat
export PATH="/home/deploy/.bun/bin:/usr/bin:/usr/local/bin:$PATH"
bun run type-check 2>&1 | tail -30
```

Fix any type errors introduced by the changes.

**Step 2: Run build**

```bash
bun run build 2>&1 | tail -30
```

Fix any build errors.

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat(billing): complete credit system migration with upsell UI"
```

---

## Execution Order & Dependencies

```
Task 1 (constants) ──┐
                      ├── Task 2 (usage tracking)
Task 3 (topup router)─┤
                      ├── Task 4 (spend router + getCreditState)
Task 5 (sub router) ──┤
Task 6 (fulfillment) ─┘
                      │
                      ▼
Task 14 (i18n keys) ──── needed by all UI tasks
                      │
                      ▼
Task 7 (CreditWidget) ─── can be parallel ───┐
Task 8 (LowBalance) ───── can be parallel ───┤
Task 9 (ExhaustedModal) ─ can be parallel ───┤
Task 10 (Welcome) ──────  can be parallel ───┤
Task 11 (Plans page) ───── can be parallel ──┤
Task 12 (Usage page) ───── can be parallel ──┤
Task 13 (Funds page) ───── can be parallel ──┘
                      │
                      ▼
Task 15 (DB seed update) ─── after code deployed
Task 16 (build & verify)
```

Backend tasks (1-6) must be done first. Then i18n (14). Then all frontend tasks (7-13) can be done in parallel. DB update (15) should be done after code is deployed. Final verification (16) last.
