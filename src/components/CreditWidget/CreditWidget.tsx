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
    refetchInterval: 60_000,
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
