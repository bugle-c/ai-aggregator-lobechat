'use client';

import { Button, Flex, Modal, Typography } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

export interface UpsellFallbackAction {
  label: string;
  onClick: () => void;
}

interface Props {
  /**
   * Optional third choice, e.g. «Продолжить на GPT Image 2» when a preset's
   * recommended model is locked: the user keeps the style on the model
   * they already have instead of choosing between paying and leaving.
   */
  fallbackAction?: UpsellFallbackAction;
  modelName: string;
  onClose: () => void;
  open: boolean;
  planPriceRub: number;
  requiredPlan: string;
}

const UpsellModal = memo<Props>(
  ({ fallbackAction, modelName, onClose, open, planPriceRub, requiredPlan }) => {
    const { t } = useTranslation('onboarding');
    // Use react-router-dom's useNavigate — this modal lives under the
    // SPA-routed `(main)` tree, where `next/navigation` push() doesn't
    // actually trigger a route change.
    const navigate = useNavigate();

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
        <Flex wrap gap={8} justify="flex-end">
          {fallbackAction ? (
            <Button onClick={fallbackAction.onClick}>{fallbackAction.label}</Button>
          ) : (
            <Button onClick={onClose}>{t('upsellModal.ctaClose')}</Button>
          )}
          <Button
            type="primary"
            onClick={() => {
              onClose();
              navigate('/settings/plans');
            }}
          >
            {t('upsellModal.ctaUpgrade', { plan: requiredPlan, price: planPriceRub })}
          </Button>
        </Flex>
      </Modal>
    );
  },
);

UpsellModal.displayName = 'UpsellModal';

export default UpsellModal;
