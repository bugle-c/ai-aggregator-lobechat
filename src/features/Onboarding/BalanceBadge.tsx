'use client';

import { Tag, Tooltip } from 'antd';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import BalanceExplainSheet from '@/features/MobileGlobalHeader/BalanceExplainSheet';
import { useIsMobile } from '@/hooks/useIsMobile';
import { lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

/**
 * Top-bar balance badge.
 *
 * Shows remaining credits = (creditLimit - creditsUsed + creditBalance).
 * Colors:
 *   green  -> plenty of credits
 *   orange -> ≤ 5 remaining (tooltip nudges top-up)
 *   red    -> 0 remaining (clicks to /settings/plans)
 */
const BalanceBadge = memo(() => {
  const { t } = useTranslation('onboarding');
  const navigate = useNavigate();
  const isLogin = useUserStore(authSelectors.isLogin);
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data } = lambdaQuery.spend.getCreditState.useQuery(undefined, {
    enabled: isLogin,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (!isLogin || !data) return null;

  const remaining = Math.max(0, data.totalAvailable - data.creditsUsed);
  const isLow = remaining > 0 && remaining <= 5;
  const isEmpty = remaining <= 0;

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

  const color = isEmpty ? 'red' : isLow ? 'orange' : 'green';
  const label = isEmpty ? t('balance.empty') : t('balance.label', { count: remaining });

  const tag = (
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
  );

  const wrapped = isEmpty ? (
    <Tooltip title={t('balance.emptyTooltip')}>{tag}</Tooltip>
  ) : isLow ? (
    <Tooltip title={t('balance.lowTooltip')}>{tag}</Tooltip>
  ) : (
    tag
  );

  return (
    <>
      {wrapped}
      {isMobile && (
        <BalanceExplainSheet
          monthlyResetDate={null}
          open={sheetOpen}
          remainingCredits={remaining}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </>
  );
});

BalanceBadge.displayName = 'OnboardingBalanceBadge';

export default BalanceBadge;
