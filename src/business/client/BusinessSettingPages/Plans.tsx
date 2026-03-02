'use client';

import { Flexbox, Grid } from '@lobehub/ui';
import { Button, Card, Divider, Progress, Spin, Tag, Typography } from 'antd';
import { Check } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';
import { lambdaQuery } from '@/libs/trpc/client';

const { Text, Title } = Typography;

// Approximate messages per credit (1 credit ≈ 1 message)
const MESSAGES_HINT: Record<string, string> = {
  basic: '~33 сообщений/день',
  free: '~50 сообщений',
  pro: '~330 сообщений/день',
};

const PLAN_FEATURES: Record<string, string[]> = {
  basic: ['plans.features.allModels', 'plans.features.priority'],
  free: ['plans.features.allModels'],
  pro: ['plans.features.allModels', 'plans.features.priority', 'plans.features.earlyAccess'],
};

const Plans = memo(() => {
  const { t } = useTranslation('subscription');

  const { data: plans, isLoading: plansLoading } = lambdaQuery.subscription.getPlans.useQuery();
  const { data: billing, isLoading: billingLoading } =
    lambdaQuery.subscription.getBillingState.useQuery();
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
  const creditLimit = billing?.creditLimit || 0;
  const creditsUsed = billing?.creditsUsed || 0;
  const creditBalance = billing?.creditBalance || 0;
  const totalAvailable = creditLimit + creditBalance;
  const usagePercent = totalAvailable > 0 ? Math.round((creditsUsed / totalAvailable) * 100) : 0;

  return (
    <>
      <SettingHeader title={t('tab.plans')} />

      {/* Current usage */}
      <Card style={{ marginTop: 16 }}>
        <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 12 }}>
          <Title level={5} style={{ margin: 0 }}>
            {currentPlan?.name || 'Старт'}
            {currentPlan && currentPlan.priceRub > 0 && (
              <Tag color="blue" style={{ marginLeft: 8 }}>
                {currentPlan.priceRub} ₽/мес
              </Tag>
            )}
          </Title>
          {billing?.subscriptionExpiresAt && (
            <Text type="secondary">
              до {new Date(billing.subscriptionExpiresAt).toLocaleDateString('ru-RU')}
            </Text>
          )}
        </Flexbox>
        <Progress
          format={() => `${creditsUsed} / ${totalAvailable} кредитов`}
          percent={Math.min(usagePercent, 100)}
          strokeColor={usagePercent > 90 ? '#ff4d4f' : usagePercent > 70 ? '#faad14' : undefined}
        />
        <Text style={{ marginTop: 4 }} type="secondary">
          План: {creditLimit} кредитов | Пополнения: {creditBalance} кредитов
        </Text>
      </Card>

      {/* Plan comparison */}
      <Title level={5} style={{ marginBottom: 0, marginTop: 24 }}>
        Выберите подходящий план
      </Title>
      <Grid gap={16} maxItemWidth={220} rows={3} style={{ marginTop: 12 }}>
        {plans?.map((plan) => {
          const isCurrent = currentPlan?.id === plan.id;
          const isPopular = plan.slug === 'basic';
          const features = PLAN_FEATURES[plan.slug] || PLAN_FEATURES.free;
          const hint = MESSAGES_HINT[plan.slug] || '';

          return (
            <Card
              key={plan.id}
              size="small"
              style={{
                border: isCurrent
                  ? '2px solid #52c41a'
                  : isPopular
                    ? '2px solid #1677ff'
                    : undefined,
                position: 'relative',
              }}
            >
              {isPopular && !isCurrent && (
                <Tag
                  color="blue"
                  style={{
                    left: '50%',
                    position: 'absolute',
                    top: -12,
                    transform: 'translateX(-50%)',
                  }}
                >
                  {t('plans.popular')}
                </Tag>
              )}
              <Flexbox align="center" gap={8} style={{ paddingTop: isPopular ? 8 : 0 }}>
                <Title level={5} style={{ margin: 0 }}>
                  {plan.name}
                </Title>
                <Text style={{ fontSize: 24, fontWeight: 600 }}>
                  {plan.priceRub === 0 ? t('plans.free') : `${plan.priceRub} ₽`}
                </Text>
                {plan.priceRub > 0 && (
                  <Text style={{ marginTop: -6 }} type="secondary">
                    в месяц
                  </Text>
                )}
                <Divider style={{ margin: '4px 0' }} />
                <Text strong>{plan.tokenLimit} кредитов/мес</Text>
                {hint && (
                  <Text style={{ fontSize: 12 }} type="secondary">
                    {hint}
                  </Text>
                )}
                <Flexbox gap={4} style={{ marginTop: 4, width: '100%' }}>
                  {features.map((featureKey) => (
                    <Flexbox horizontal align="center" gap={6} key={featureKey}>
                      <Check size={14} style={{ color: '#52c41a', flexShrink: 0 }} />
                      <Text style={{ fontSize: 12 }}>{t(featureKey as any)}</Text>
                    </Flexbox>
                  ))}
                </Flexbox>
                <div style={{ marginTop: 8, width: '100%' }}>
                  {isCurrent ? (
                    <Button block disabled>
                      {t('plans.current')}
                    </Button>
                  ) : plan.priceRub > 0 ? (
                    <Button
                      block
                      loading={subscribeMutation.isPending}
                      type={isPopular ? 'primary' : 'default'}
                      onClick={() => subscribeMutation.mutate({ planId: plan.id })}
                    >
                      {t('plans.subscribe')}
                    </Button>
                  ) : null}
                </div>
              </Flexbox>
            </Card>
          );
        })}
      </Grid>

      {/* Top up */}
      {packages && packages.length > 0 && (
        <>
          <Title level={5} style={{ marginBottom: 0, marginTop: 24 }}>
            {t('funds.topUp.title')}
          </Title>
          <Grid gap={16} maxItemWidth={200} rows={3} style={{ marginTop: 12 }}>
            {packages.map((pkg) => (
              <Card key={pkg.amountRub} size="small">
                <Flexbox align="center" gap={8}>
                  <Title level={5} style={{ margin: 0 }}>
                    {pkg.label}
                  </Title>
                  <Text style={{ fontSize: 20 }}>{pkg.amountRub} ₽</Text>
                  <Button
                    block
                    loading={topUpMutation.isPending}
                    onClick={() => topUpMutation.mutate({ amountRub: pkg.amountRub })}
                  >
                    {t('funds.topUp.purchaseNow')}
                  </Button>
                </Flexbox>
              </Card>
            ))}
          </Grid>
        </>
      )}
    </>
  );
});

Plans.displayName = 'Plans';
export default Plans;
