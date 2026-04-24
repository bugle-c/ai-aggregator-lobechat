'use client';

import { Flexbox } from '@lobehub/ui';
import { Card, Progress, Spin, Statistic, Typography } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';
import { lambdaQuery } from '@/libs/trpc/client';

const { Text, Title } = Typography;

const formatTokens = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
};

const Usage = memo(() => {
  const { t } = useTranslation('subscription');

  const { data, isLoading } = lambdaQuery.spend.getUsageSummary.useQuery();

  if (isLoading) {
    return (
      <>
        <SettingHeader title={t('tab.usage')} />
        <Flexbox align="center" justify="center" style={{ padding: 64 }}>
          <Spin />
        </Flexbox>
      </>
    );
  }

  const plan = data?.plan || 'Free';
  const creditLimit = data?.creditLimit || 0;
  const creditBalance = data?.creditBalance || 0;
  const creditsUsed = data?.creditsUsed || 0;
  const totalAvailable = data?.totalAvailable || 0;
  const usagePercent = data?.usagePercent || 0;

  return (
    <>
      <SettingHeader title={t('tab.usage')} />

      <Card style={{ marginTop: 16 }}>
        <Title level={5} style={{ marginBottom: 16, marginTop: 0 }}>
          {t('usage.credit.title')}
        </Title>

        <Progress
          format={() => `${formatTokens(creditsUsed)} / ${formatTokens(totalAvailable)}`}
          percent={usagePercent}
          strokeColor={usagePercent > 90 ? '#ff4d4f' : usagePercent > 70 ? '#faad14' : undefined}
          style={{ marginBottom: 24 }}
        />

        <Flexbox horizontal gap={16} wrap="wrap">
          <Statistic title={t('currentPlan.title')} value={plan} />
          <Statistic
            title={t('usage.credit.subscription.used')}
            value={formatTokens(creditLimit)}
          />
          <Statistic title={t('usage.credit.addon.used')} value={formatTokens(creditBalance)} />
          <Statistic title={t('usage.used')} value={formatTokens(creditsUsed)} />
        </Flexbox>

        <Flexbox horizontal gap={8} style={{ marginTop: 24 }}>
          <Text type="secondary">{t('usage.credit.desc')}</Text>
        </Flexbox>
      </Card>
    </>
  );
});

Usage.displayName = 'Usage';
export default Usage;
