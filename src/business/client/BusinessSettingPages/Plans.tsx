'use client';

import { Flexbox, Grid } from '@lobehub/ui';
import { App, Button, Card, Divider, Input, Modal, Progress, Radio, Spin, Tag, Typography } from 'antd';
import { Check } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';
import { useIsMobile } from '@/hooks/useIsMobile';
import { lambdaQuery, lambdaClient } from '@/libs/trpc/client';

import PlansMobileLayout from './PlansMobileLayout';

const CANCEL_REASONS: { code: string; label: string }[] = [
  { code: 'too_expensive', label: 'Слишком дорого' },
  { code: 'not_using', label: 'Перестал пользоваться' },
  { code: 'missing_feature', label: 'Не хватает функций' },
  { code: 'switched', label: 'Перешёл на другой сервис' },
  { code: 'temporary', label: 'Временно — потом вернусь' },
  { code: 'other', label: 'Другое' },
];

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
  const { message } = App.useApp();
  const utils = lambdaQuery.useUtils();

  // Cancellation modal state — kept inside the component so the modal
  // closes correctly on success and re-opens on the next click.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState<string>('not_using');
  const [cancelText, setCancelText] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const { data: plans, isLoading: plansLoading } = lambdaQuery.subscription.getPlans.useQuery();
  const { data: billing, isLoading: billingLoading } =
    lambdaQuery.subscription.getBillingState.useQuery();
  const { data: packages } = lambdaQuery.topUp.getPackages.useQuery();

  const handleCancelSubmit = async () => {
    setCancelling(true);
    try {
      await lambdaClient.subscription.cancelSubscription.mutate({
        reasonCode: cancelReason as any,
        reasonText: cancelText.trim() || undefined,
      });
      message.success('Подписка будет активна до окончания оплаченного периода');
      setCancelOpen(false);
      setCancelText('');
      // Refresh billing state so the banner re-renders with cancelled flag.
      await utils.subscription.getBillingState.invalidate();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Не удалось отменить');
    } finally {
      setCancelling(false);
    }
  };

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

  const isMobile = useIsMobile();

  if (isMobile && plans && billing) {
    // On mobile we render the simplified vertical-stack layout. Cancel
    // flow + cancellation modal are intentionally NOT included here yet —
    // Task 4 will swap them for a bottom-sheet survey. For now mobile
    // users who want to cancel must open the page on desktop. The link
    // below exposes that explicitly.
    return (
      <>
        <SettingHeader title={t('tab.plans')} />
        <PlansMobileLayout
          billing={{ creditBalance, creditLimit, creditsUsed, subscriptionExpiresAt: billing?.subscriptionExpiresAt }}
          currentPlan={currentPlan ? { name: currentPlan.name, priceRub: currentPlan.priceRub, slug: currentPlan.slug } : null}
          features={PLAN_FEATURES}
          plans={plans.map((p) => ({ id: p.id, name: p.name, priceRub: p.priceRub, slug: p.slug, tokenLimit: p.tokenLimit }))}
          subscribePending={subscribeMutation.isPending}
          onSelect={(planId) => subscribeMutation.mutate({ planId })}
        />
      </>
    );
  }

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

        {currentPlan && currentPlan.priceRub > 0 && (
          <>
            <Divider style={{ margin: '12px 0' }} />
            {billing?.cancelledAt ? (
              <Flexbox horizontal align="center" justify="space-between" gap={12}>
                <Text type="warning">
                  Подписка отменена. Доступ сохраняется до{' '}
                  {billing.subscriptionExpiresAt
                    ? new Date(billing.subscriptionExpiresAt).toLocaleDateString('ru-RU')
                    : '—'}
                  . После этой даты — план «Старт».
                </Text>
              </Flexbox>
            ) : billing?.autoRenew && billing.hasSavedPaymentMethod ? (
              <Flexbox horizontal align="center" justify="space-between" gap={12}>
                <Text type="secondary">
                  Подписка продлевается автоматически. Списание {currentPlan.priceRub} ₽
                  каждый месяц до отмены.
                </Text>
                <Button danger size="small" onClick={() => setCancelOpen(true)}>
                  Отменить подписку
                </Button>
              </Flexbox>
            ) : (
              <Flexbox horizontal align="center" justify="space-between" gap={12}>
                <Text type="secondary">
                  Авто-продление не настроено — подписка истечёт по окончании периода.
                </Text>
              </Flexbox>
            )}
          </>
        )}
      </Card>

      <Modal
        title="Отменить подписку?"
        open={cancelOpen}
        confirmLoading={cancelling}
        okText="Отменить подписку"
        okButtonProps={{ danger: true }}
        cancelText="Передумал"
        onCancel={() => setCancelOpen(false)}
        onOk={handleCancelSubmit}
        width={460}
      >
        <Text type="secondary">
          Доступ к платным функциям сохранится до{' '}
          {billing?.subscriptionExpiresAt
            ? new Date(billing.subscriptionExpiresAt).toLocaleDateString('ru-RU')
            : '—'}
          . После этой даты вы вернётесь на тариф «Старт». Расскажите, почему уходите —
          это поможет нам стать лучше:
        </Text>
        <Radio.Group
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}
        >
          {CANCEL_REASONS.map((r) => (
            <Radio key={r.code} value={r.code}>
              {r.label}
            </Radio>
          ))}
        </Radio.Group>
        {cancelReason === 'other' && (
          <Input.TextArea
            placeholder="Расскажите подробнее (необязательно)"
            value={cancelText}
            onChange={(e) => setCancelText(e.target.value)}
            rows={3}
            maxLength={500}
            style={{ marginTop: 12 }}
          />
        )}
      </Modal>

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
