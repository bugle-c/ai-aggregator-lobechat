'use client';

import { Tag, Tooltip } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

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
 *   red    -> 0 remaining (clicks to /settings/subscription/plans)
 */
const BalanceBadge = memo(() => {
  const { t } = useTranslation('onboarding');
  const navigate = useNavigate();
  const isLogin = useUserStore(authSelectors.isLogin);

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
    if (isEmpty || isLow) navigate('/settings/subscription/plans');
  };

  const color = isEmpty ? 'red' : isLow ? 'orange' : 'green';
  const label = isEmpty ? t('balance.empty') : t('balance.label', { count: remaining });

  const tag = (
    <Tag
      color={color}
      style={{
        borderRadius: 12,
        cursor: isEmpty || isLow ? 'pointer' : 'default',
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

  if (isEmpty) {
    return <Tooltip title={t('balance.emptyTooltip')}>{tag}</Tooltip>;
  }
  if (isLow) {
    return <Tooltip title={t('balance.lowTooltip')}>{tag}</Tooltip>;
  }
  return tag;
});

BalanceBadge.displayName = 'OnboardingBalanceBadge';

export default BalanceBadge;
