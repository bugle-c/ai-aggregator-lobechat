'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Card, Modal, Typography } from 'antd';
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

  const { planName, daysUntilReset, creditLimit } = data;
  const upgradePlans = plans.filter((p) => p.priceRub > 0);
  const cheapestTopup = packages?.[0];

  return (
    <Modal
      centered
      footer={null}
      open={open}
      width={480}
      title={
        <Flexbox horizontal align="center" gap={8}>
          <Icon icon={Zap} />
          {t('modal.exhausted.title')}
        </Flexbox>
      }
      onCancel={onClose}
    >
      <Flexbox gap={16}>
        <Text>{t('modal.exhausted.desc', { credits: creditLimit, plan: planName })}</Text>
        <Text type="secondary">{t('modal.exhausted.resetIn', { days: daysUntilReset })}</Text>

        <Flexbox horizontal gap={12}>
          {upgradePlans.map((plan) => (
            <Card key={plan.id} size="small" style={{ flex: 1, textAlign: 'center' }}>
              <Flexbox align="center" gap={8}>
                <Title level={5} style={{ margin: 0 }}>
                  {plan.name}
                </Title>
                <Text style={{ fontSize: 18 }}>
                  {plan.priceRub} {'₽/мес'}
                </Text>
                <Text type="secondary">
                  {plan.tokenLimit} {'кредитов'}
                </Text>
                <Button
                  block
                  loading={subscribeMutation.isPending}
                  type="primary"
                  onClick={() => subscribeMutation.mutate({ planId: plan.id })}
                >
                  {t('modal.exhausted.select')}
                </Button>
              </Flexbox>
            </Card>
          ))}
        </Flexbox>

        {cheapestTopup && (
          <Button
            block
            loading={topUpMutation.isPending}
            onClick={() => topUpMutation.mutate({ amountRub: cheapestTopup.amountRub })}
          >
            {t('modal.exhausted.topup', { price: cheapestTopup.amountRub })}
          </Button>
        )}
      </Flexbox>
    </Modal>
  );
});

CreditsExhaustedModal.displayName = 'CreditsExhaustedModal';
export default CreditsExhaustedModal;
