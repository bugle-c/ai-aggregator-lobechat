'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Card, Modal, Tag, Typography } from 'antd';
import { Zap } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';

const { Text, Title } = Typography;

interface CreditsExhaustedModalProps {
  onClose: () => void;
  open: boolean;
}

const CreditsExhaustedModal = memo<CreditsExhaustedModalProps>(({ open, onClose }) => {
  const { t } = useTranslation('subscription');

  const { data } = lambdaQuery.spend.getCreditState.useQuery();
  const { data: plans } = lambdaQuery.subscription.getPlans.useQuery();
  const { data: packages } = lambdaQuery.topUp.getPackages.useQuery();

  const subscribeMutation = lambdaQuery.subscription.createPayment.useMutation({
    onSuccess: (d) => {
      if (d.paymentUrl) window.location.href = d.paymentUrl;
    },
  });

  const topUpMutation = lambdaQuery.topUp.createPayment.useMutation({
    onSuccess: (d) => {
      if (d.paymentUrl) window.location.href = d.paymentUrl;
    },
  });

  if (!data || !plans) return null;

  const { planName, planSlug, daysUntilReset, creditLimit } = data;
  const upgradePlans = plans.filter((p) => p.priceRub > 0);
  const cheapestTopup = packages?.[0];

  // Recommended = next tier above the user's current plan. Users on free →
  // recommend basic; on basic → recommend pro. If no "next", first priced
  // plan is recommended (usually basic).
  const planOrder = ['free', 'basic', 'pro', 'pro_max'];
  const currentIdx = planOrder.indexOf(planSlug || 'free');
  const recommendedSlug = planOrder[currentIdx + 1] || 'basic';
  const recommendedId =
    upgradePlans.find((p) => p.slug === recommendedSlug)?.id ?? upgradePlans[0]?.id;

  // "X× больше" — visual anchor for how much more value the upgrade gives.
  const formatMultiplier = (planCredits: number): string => {
    if (!creditLimit || creditLimit <= 0) return '';
    const ratio = Math.round(planCredits / creditLimit);
    return ratio > 1 ? `×${ratio} больше` : '';
  };

  return (
    <Modal
      centered
      footer={null}
      open={open}
      width={540}
      title={
        <Flexbox align="center" gap={8} horizontal>
          <Icon icon={Zap} />
          {t('modal.exhausted.title')}
        </Flexbox>
      }
      onCancel={onClose}
    >
      <Flexbox gap={16}>
        <Text>{t('modal.exhausted.desc', { credits: creditLimit, plan: planName })}</Text>
        <Text type="secondary">
          {t('modal.exhausted.resetIn', { days: daysUntilReset })} · без доступа до сброса
        </Text>

        <Flexbox gap={12} horizontal>
          {upgradePlans.map((plan) => {
            const isRecommended = plan.id === recommendedId;
            const multiplier = formatMultiplier(plan.tokenLimit);
            return (
              <Card
                key={plan.id}
                size="small"
                style={{
                  borderColor: isRecommended ? '#1677ff' : undefined,
                  borderWidth: isRecommended ? 2 : 1,
                  flex: 1,
                  position: 'relative',
                  textAlign: 'center',
                }}
              >
                {isRecommended && (
                  <Tag
                    color="blue"
                    style={{ left: '50%', position: 'absolute', top: -10, transform: 'translateX(-50%)' }}
                  >
                    Рекомендуем
                  </Tag>
                )}
                <Flexbox align="center" gap={6}>
                  <Title level={5} style={{ margin: 0 }}>
                    {plan.name}
                  </Title>
                  <Text style={{ fontSize: 20, fontWeight: 600 }}>{plan.priceRub} ₽/мес</Text>
                  <Text type="secondary">{plan.tokenLimit.toLocaleString('ru-RU')} кредитов</Text>
                  {multiplier && (
                    <Tag color={isRecommended ? 'blue' : 'default'} style={{ margin: 0 }}>
                      {multiplier}
                    </Tag>
                  )}
                  <Button
                    block
                    loading={subscribeMutation.isPending}
                    type={isRecommended ? 'primary' : 'default'}
                    onClick={() => subscribeMutation.mutate({ planId: plan.id })}
                  >
                    {isRecommended ? 'Продолжить общение' : t('modal.exhausted.select')}
                  </Button>
                </Flexbox>
              </Card>
            );
          })}
        </Flexbox>

        {cheapestTopup && (
          <Button
            block
            loading={topUpMutation.isPending}
            type="dashed"
            onClick={() => topUpMutation.mutate({ amountRub: cheapestTopup.amountRub })}
          >
            Или разово докупить за {cheapestTopup.amountRub} ₽
          </Button>
        )}
      </Flexbox>
    </Modal>
  );
});

CreditsExhaustedModal.displayName = 'CreditsExhaustedModal';
export default CreditsExhaustedModal;
