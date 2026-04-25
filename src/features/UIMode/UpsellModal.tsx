'use client';

import { Button, Flex, Modal, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  modelName: string;
  onClose: () => void;
  open: boolean;
  planPriceRub: number;
  requiredPlan: string;
}

const UpsellModal = memo<Props>(({ modelName, onClose, open, planPriceRub, requiredPlan }) => {
  const { t } = useTranslation('onboarding');
  const router = useRouter();

  return (
    <Modal
      centered
      footer={null}
      open={open}
      title={t('upsellModal.title', { modelName, plan: requiredPlan })}
      width={460}
      onCancel={onClose}
    >
      <Typography.Paragraph>{t('upsellModal.body', { plan: requiredPlan })}</Typography.Paragraph>
      <Flex gap={8} justify="flex-end">
        <Button onClick={onClose}>{t('upsellModal.ctaClose')}</Button>
        <Button
          type="primary"
          onClick={() => {
            onClose();
            router.push('/settings/subscription/plans');
          }}
        >
          {t('upsellModal.ctaUpgrade', { plan: requiredPlan, price: planPriceRub })}
        </Button>
      </Flex>
    </Modal>
  );
});

UpsellModal.displayName = 'UpsellModal';

export default UpsellModal;
