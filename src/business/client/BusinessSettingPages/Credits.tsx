'use client';

import { Flexbox, Grid } from '@lobehub/ui';
import { Button, Card, Spin, Statistic, Typography } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';
import { lambdaQuery } from '@/libs/trpc/client';

const { Title } = Typography;

const formatTokens = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
};

const Credits = memo(() => {
  const { t } = useTranslation('subscription');

  const { data: usage, isLoading: usageLoading } = lambdaQuery.spend.getUsageSummary.useQuery();
  const { data: packages, isLoading: packagesLoading } = lambdaQuery.topUp.getPackages.useQuery();

  const topUpMutation = lambdaQuery.topUp.createPayment.useMutation({
    onSuccess: (data) => {
      if (data.paymentUrl) {
        window.location.href = data.paymentUrl;
      }
    },
  });

  const isLoading = usageLoading || packagesLoading;

  if (isLoading) {
    return (
      <>
        <SettingHeader title={t('tab.funds')} />
        <Flexbox align="center" justify="center" style={{ padding: 64 }}>
          <Spin />
        </Flexbox>
      </>
    );
  }

  return (
    <>
      <SettingHeader title={t('tab.funds')} />

      {/* Balance */}
      <Card style={{ marginTop: 16 }}>
        <Title level={5} style={{ marginBottom: 16, marginTop: 0 }}>
          {t('balance.title')}
        </Title>
        <Flexbox gap={16} horizontal wrap="wrap">
          <Statistic
            title={t('balance.creditBalance')}
            value={formatTokens(usage?.creditBalance || 0)}
          />
          <Statistic title={t('usage.used')} value={formatTokens(usage?.creditsUsed || 0)} />
        </Flexbox>
      </Card>

      {/* Top up packages */}
      {packages && packages.length > 0 && (
        <Card style={{ marginTop: 16 }}>
          <Title level={5} style={{ marginBottom: 16, marginTop: 0 }}>
            {t('funds.topUp.title')}
          </Title>
          <Grid gap={16} maxItemWidth={200} rows={3}>
            {packages.map((pkg) => (
              <Card key={pkg.amountRub} size="small">
                <Flexbox align="center" gap={12}>
                  <Title level={5} style={{ margin: 0 }}>
                    {pkg.label}
                  </Title>
                  <Statistic suffix="₽" value={pkg.amountRub} />
                  <Button
                    loading={topUpMutation.isPending}
                    onClick={() => topUpMutation.mutate({ amountRub: pkg.amountRub })}
                  >
                    {t('funds.topUp.purchaseNow')}
                  </Button>
                </Flexbox>
              </Card>
            ))}
          </Grid>
        </Card>
      )}
    </>
  );
});

Credits.displayName = 'Credits';
export default Credits;
