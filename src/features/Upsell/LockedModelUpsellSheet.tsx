'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Drawer, Typography } from 'antd';
import { memo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { useTrackUpsell } from './useTrackUpsell';

const { Text, Title } = Typography;

interface Props {
  modelDescription?: string;
  modelId: string;
  onClose: () => void;
  open: boolean;
  requiredPlanName: string;
  requiredPlanPriceRub: number;
}

/**
 * Mobile bottom-sheet shown when a free user taps a locked premium model
 * in the model switcher. Replaces the desktop tooltip on small screens
 * with a touch-friendly upsell card: model description, price, primary
 * upgrade CTA, secondary "compare plans" link.
 */
const LockedModelUpsellSheet = memo<Props>(
  ({ modelDescription, modelId, onClose, open, requiredPlanName, requiredPlanPriceRub }) => {
    const navigate = useNavigate();
    const { click, impression } = useTrackUpsell();

    useEffect(() => {
      if (open) {
        impression('locked_model', {
          modelBlocked: modelId,
          planOffered: requiredPlanName,
        });
      }
    }, [open, modelId, requiredPlanName, impression]);

    const goToPlans = () => {
      click('locked_model', { targetPlan: requiredPlanName });
      onClose();
      navigate('/settings/plans?utm_source=locked_model');
    };

    return (
      <Drawer
        height="auto"
        open={open}
        placement="bottom"
        styles={{ body: { padding: 0 }, header: { display: 'none' } }}
        onClose={onClose}
      >
        <Flexbox gap={12} paddingBlock={24} paddingInline={20}>
          <Title level={4} style={{ margin: 0 }}>
            Доступно на тарифе {requiredPlanName}
          </Title>
          <Text type="secondary">
            {modelDescription ?? `Модель «${modelId}» недоступна на текущем тарифе.`}
          </Text>
          <Title level={2} style={{ margin: 0 }}>
            {requiredPlanPriceRub} ₽
            <Text style={{ fontSize: 14, fontWeight: 'normal' }} type="secondary">
              {' '}
              /мес
            </Text>
          </Title>
          <Button block size="large" type="primary" onClick={goToPlans}>
            Перейти на {requiredPlanName}
          </Button>
          <Button block type="default" onClick={goToPlans}>
            Сравнить тарифы
          </Button>
        </Flexbox>
      </Drawer>
    );
  },
);

LockedModelUpsellSheet.displayName = 'LockedModelUpsellSheet';

export default LockedModelUpsellSheet;
