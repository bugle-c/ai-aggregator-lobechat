'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Drawer, Typography } from 'antd';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

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

    const goToPlans = () => {
      onClose();
      navigate('/settings/subscription/plans?utm_source=locked_model');
    };

    return (
      <Drawer
        height="auto"
        onClose={onClose}
        open={open}
        placement="bottom"
        styles={{ body: { padding: 0 }, header: { display: 'none' } }}
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
          <Button block onClick={goToPlans} size="large" type="primary">
            Перейти на {requiredPlanName}
          </Button>
          <Button block onClick={goToPlans} type="default">
            Сравнить тарифы
          </Button>
        </Flexbox>
      </Drawer>
    );
  },
);

LockedModelUpsellSheet.displayName = 'LockedModelUpsellSheet';

export default LockedModelUpsellSheet;
