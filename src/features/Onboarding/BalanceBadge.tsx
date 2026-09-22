'use client';

import { Tag, Tooltip } from 'antd';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { selectBalanceView } from '@/business/client/balanceView';
import { creditsToHuman } from '@/business/utils/creditsToHuman';
import BalanceExplainSheet from '@/features/MobileGlobalHeader/BalanceExplainSheet';
import { useIsMobile } from '@/hooks/useIsMobile';
import { lambdaQuery } from '@/libs/trpc/client';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

/**
 * Top-bar balance badge.
 *
 * Variant comes from `selectBalanceView` (EXP-003):
 *   daily     — free plan: «5 сообщений в день · осталось N» (short «N из 5
 *               сегодня» on mobile); orange at 1 left, red at 0
 *   purchased — free plan with purchased credits lifting the daily gate:
 *               «N кредитов · без дневного лимита»
 *   credits   — paid plans: remaining monthly credits, orange ≤ 5, red at 0
 * Click: mobile opens the explainer sheet, desktop goes to /settings/plans.
 */
const BalanceBadge = memo(() => {
  const { t } = useTranslation('onboarding');
  const navigate = useNavigate();
  const isLogin = useUserStore(authSelectors.isLogin);
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data, refetch } = lambdaQuery.spend.getCreditState.useQuery(undefined, {
    enabled: isLogin,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  // A message just completed → the balance changed. Refetch immediately instead
  // of waiting up to 60s for the next poll. We watch the global "AI generating"
  // flag and refetch on the active→idle transition.
  const isGenerating = useChatStore(operationSelectors.isAgentRuntimeRunning);
  const wasGeneratingRef = useRef(isGenerating);
  useEffect(() => {
    if (wasGeneratingRef.current && !isGenerating) refetch();
    wasGeneratingRef.current = isGenerating;
  }, [isGenerating, refetch]);

  if (!isLogin || !data) return null;

  const view = selectBalanceView(data);

  const handleClick = () => {
    // Mobile: open the credit-explainer bottom-sheet (offers context +
    // both top-up and upgrade paths). Desktop: keep the existing
    // single-action navigate-to-plans behavior.
    if (isMobile) {
      setSheetOpen(true);
      return;
    }
    navigate('/settings/plans');
  };

  let isEmpty: boolean;
  let isLow: boolean;
  let label: string;
  let tooltip: string;

  if (view.kind === 'daily') {
    const { quota, remaining, resetTime } = view;
    isEmpty = remaining <= 0;
    isLow = remaining === 1;
    label = isMobile
      ? t('balance.dailyShort', { quota, remaining })
      : t('balance.daily', { quota, remaining });
    tooltip = isEmpty
      ? t('balance.dailyEmptyTooltip', { time: resetTime })
      : t('balance.dailyTooltip', { time: resetTime });
  } else {
    const { remaining } = view;
    isEmpty = remaining <= 0;
    isLow = remaining > 0 && remaining <= 5;
    label =
      view.kind === 'purchased'
        ? t('balance.purchased', { count: remaining })
        : isEmpty
          ? t('balance.empty')
          : t('balance.label', { count: remaining });
    // Human-work equivalent so users reason in «картинки и ответы», not credits.
    const human = creditsToHuman(remaining);
    const humanLine = t('balance.human', { answers: human.answers, images: human.images });
    tooltip = isEmpty
      ? t('balance.emptyTooltip')
      : isLow
        ? `${t('balance.lowTooltip')} ${humanLine}`
        : humanLine;
  }

  const color = isEmpty ? 'red' : isLow ? 'orange' : 'green';

  return (
    <>
      <Tooltip title={tooltip}>
        <Tag
          color={color}
          style={{
            borderRadius: 12,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 500,
            marginInlineEnd: 0,
            paddingBlock: 2,
            paddingInline: 10,
          }}
          onClick={handleClick}
        >
          {label}
        </Tag>
      </Tooltip>
      {isMobile && (
        <BalanceExplainSheet open={sheetOpen} view={view} onClose={() => setSheetOpen(false)} />
      )}
    </>
  );
});

BalanceBadge.displayName = 'OnboardingBalanceBadge';

export default BalanceBadge;
