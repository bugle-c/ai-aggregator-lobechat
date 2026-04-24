'use client';

import { Flexbox } from '@lobehub/ui';
import { Card, Typography } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

const { Text } = Typography;

const Referral = memo(() => {
  const { t } = useTranslation('subscription');

  return (
    <>
      <SettingHeader title={t('tab.referral')} />
      <Card style={{ marginTop: 16 }}>
        <Flexbox align="center" justify="center" style={{ padding: 48 }}>
          <Text type="secondary">Реферальная программа скоро будет доступна</Text>
        </Flexbox>
      </Card>
    </>
  );
});

Referral.displayName = 'Referral';
export default Referral;
