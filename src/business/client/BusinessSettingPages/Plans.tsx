'use client';

import { Flexbox, Grid } from '@lobehub/ui';
import { Button, Card, Progress, Spin, Tag, Typography } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';
import { lambdaQuery } from '@/libs/trpc/client';

const { Text, Title } = Typography;

const formatTokens = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
};

const Plans = memo(() => {
  const { t } = useTranslation('subscription');

  const { data: plans, isLoading: plansLoading } = lambdaQuery.subscription.getPlans.useQuery();
  const { data: billing, isLoading: billingLoading } =
    lambdaQuery.subscription.getBillingState.useQuery();
  const { data: packages } = lambdaQuery.topUp.getPackages.useQuery();

  const subscribeMutation = lambdaQuery.subscription.createPayment.useMutation({
    onSuccess: (data) => {
      if (data.paymentUrl) {
        window.location.href = data.paymentUrl;
      }
    },
  });

  const topUpMutation = lambdaQuery.topUp.createPayment.useMutation({
    onSuccess: (data) => {
      if (data.paymentUrl) {
        window.location.href = data.paymentUrl;
      }
    },
  });

  const isLoading = plansLoading || billingLoading;

  if (isLoading) {
    return (
      <>
        <SettingHeader title={t('tab.plans')} />
        <Flexbox align="center" justify="center" style={{ padding: 64 }}>
          <Spin />
        </Flexbox>
      </>
    );
  }

  const currentPlan = billing?.plan;
  const tokenLimit = billing?.tokenLimit || 0;
  const tokensUsed = billing?.tokensUsedMonth || 0;
  const tokenBalance = billing?.tokenBalance || 0;
  const totalAvailable = tokenLimit + tokenBalance;
  const usagePercent = totalAvailable > 0 ? Math.round((tokensUsed / totalAvailable) * 100) : 0;

  return (
    <>
      <SettingHeader title={t('tab.plans')} />

      {/* Current plan */}
      <Card style={{ marginTop: 16 }}>
        <Title level={5} style={{ marginBottom: 16, marginTop: 0 }}>
          {t('currentPlan.title')}
        </Title>
        <Flexbox gap={8}>
          <Flexbox horizontal align="center" justify="space-between">
            <Text>
              {currentPlan?.name || 'Free'}{' '}
              {currentPlan && currentPlan.priceRub > 0 && (
                <Tag color="blue">{currentPlan.priceRub} ₽/мес</Tag>
              )}
            </Text>
            {billing?.subscriptionExpiresAt && (
              <Text type="secondary">
                до {new Date(billing.subscriptionExpiresAt).toLocaleDateString('ru-RU')}
              </Text>
            )}
          </Flexbox>
          <Progress
            format={() => `${formatTokens(tokensUsed)} / ${formatTokens(totalAvailable)}`}
            percent={Math.min(usagePercent, 100)}
            strokeColor={usagePercent > 90 ? '#ff4d4f' : undefined}
          />
          <Text type="secondary">
            {t('usage.credit.subscription.used')}: {formatTokens(tokenLimit)} |{' '}
            {t('usage.credit.addon.used')}: {formatTokens(tokenBalance)}
          </Text>
        </Flexbox>
      </Card>

      {/* Choose plan */}
      <Card style={{ marginTop: 16 }}>
        <Title level={5} style={{ marginBottom: 16, marginTop: 0 }}>
          {t('plans.changePlan')}
        </Title>
        <Grid gap={16} maxItemWidth={200} rows={3}>
          {plans?.map((plan) => {
            const isCurrent = currentPlan?.id === plan.id;
            return (
              <Card
                key={plan.id}
                size="small"
                style={{
                  border: isCurrent ? '2px solid #1677ff' : undefined,
                }}
              >
                <Flexbox align="center" gap={12}>
                  <Title level={5} style={{ margin: 0 }}>
                    {plan.name}
                  </Title>
                  <Text style={{ fontSize: 20 }}>
                    {plan.priceRub === 0 ? t('plans.free') : `${plan.priceRub} ₽/мес`}
                  </Text>
                  <Text type="secondary">{formatTokens(plan.tokenLimit)} токенов/мес</Text>
                  {isCurrent ? (
                    <Tag color="blue">{t('plans.current')}</Tag>
                  ) : plan.priceRub > 0 ? (
                    <Button
                      loading={subscribeMutation.isPending}
                      type="primary"
                      onClick={() => subscribeMutation.mutate({ planId: plan.id })}
                    >
                      {t('plans.subscribe')}
                    </Button>
                  ) : null}
                </Flexbox>
              </Card>
            );
          })}
        </Grid>
      </Card>

      {/* Top up */}
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
                  <Text style={{ fontSize: 20 }}>{pkg.amountRub} ₽</Text>
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

Plans.displayName = 'Plans';
export default Plans;
