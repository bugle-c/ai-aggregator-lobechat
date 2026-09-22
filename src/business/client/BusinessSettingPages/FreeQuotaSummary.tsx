'use client';

import { Flexbox } from '@lobehub/ui';
import { Typography } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type FreeQuota } from '@/business/client/balanceView';

const { Text } = Typography;

/**
 * Current-plan lines for free users on /settings/plans and the usage page
 * (EXP-003): today's message allowance instead of «36 / 2500 кредитов»,
 * plus the purchased and bonus credit lines when those pools exist.
 * Build the props with `freeQuotaOf(creditState)`.
 */
const FreeQuotaSummary = memo<FreeQuota>(({ bonusActive, bonusExpiresAt, view }) => {
  const { t } = useTranslation('subscription');

  return (
    <Flexbox gap={4} style={{ marginTop: 8 }}>
      <Text>
        {view.kind === 'daily'
          ? t('freeQuota.today', {
              quota: view.quota,
              remaining: view.remaining,
              time: view.resetTime,
            })
          : t('freeQuota.purchased', { count: view.remaining })}
      </Text>
      {bonusActive > 0 && (
        <Text type="secondary">
          {t('freeQuota.bonus', {
            count: bonusActive,
            date: bonusExpiresAt ? new Date(bonusExpiresAt).toLocaleDateString('ru-RU') : '—',
          })}
        </Text>
      )}
    </Flexbox>
  );
});

FreeQuotaSummary.displayName = 'FreeQuotaSummary';

export default FreeQuotaSummary;
