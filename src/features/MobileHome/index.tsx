'use client';

import { Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { memo } from 'react';

import { selectBalanceView } from '@/business/client/balanceView';
import { SuggestedPrompts } from '@/features/Onboarding';
import MobileUpgradePill from '@/features/Upsell/MobileUpgradePill';
import { lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import FeatureChipsRow from './FeatureChipsRow';
import Greeting from './Greeting';
import { useMobileAutofocus } from './useMobileAutofocus';

interface Props {
  /** Tap on a SuggestedPrompts card sends the prompt; same handler as desktop. */
  onSelectPrompt: (prompt: string) => Promise<void> | void;
}

const MobileHome = memo<Props>(({ onSelectPrompt }) => {
  // The onboarding state lives on the unified user store, not a separate
  // store. The plan's reference to `useUserOnboardingStore` doesn't exist
  // in this codebase — we read the same `onboarding` field that
  // `home/features/InputArea/index.tsx` reads via tRPC.
  const onboarding = useUserStore((s) => s.onboarding);
  const firstVisit = onboarding != null && !onboarding.firstMessageSeen;
  const isLogin = useUserStore(authSelectors.isLogin);

  useMobileAutofocus({ enabled: firstVisit });

  // The pill renders only for free users running low — read from the same
  // `getCreditState` endpoint that BalanceBadge uses, so we don't add
  // another query. EXP-003: under the daily gate «low» means ≤ 1 message
  // left today (the monthly pool is a safety cap free users never reach);
  // with purchased credits lifting the gate the old >50 % monthly rule holds.
  const { data: creditState } = lambdaQuery.spend.getCreditState.useQuery(undefined, {
    enabled: isLogin,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const { data: billingState } = lambdaQuery.subscription.getBillingState.useQuery(undefined, {
    enabled: isLogin,
    staleTime: 60_000,
  });
  const isFreePlan = billingState?.plan?.priceRub === 0 || billingState?.plan?.slug === 'free';
  const balance = creditState ? selectBalanceView(creditState) : null;
  const runningLow =
    balance?.kind === 'daily'
      ? balance.remaining <= 1
      : creditState != null &&
        creditState.totalAvailable > 0 &&
        creditState.creditsUsed / creditState.totalAvailable > 0.5;
  const showUpgradePill = !!isFreePlan && runningLow;

  return (
    <Flexbox gap={16} paddingBlock={8}>
      <Greeting />

      <MobileUpgradePill shouldRender={showUpgradePill} />

      {/* The chat input itself is rendered by the page-level component
          that hosts MobileHome — keeps MobileHome stateless w/r/t the
          editor instance. */}

      <Divider style={{ margin: 0 }}>Быстрые действия</Divider>
      <FeatureChipsRow />

      <Divider style={{ margin: 0 }}>Попробуй</Divider>
      <Flexbox paddingInline={16}>
        <SuggestedPrompts showHint={false} onSelect={onSelectPrompt} />
      </Flexbox>
    </Flexbox>
  );
});

MobileHome.displayName = 'MobileHome';

export default MobileHome;
