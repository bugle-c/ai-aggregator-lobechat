'use client';

import { Flexbox } from '@lobehub/ui';
import { Alert, Card, Spin, Table, Tag, Typography } from 'antd';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';
import { lambdaQuery } from '@/libs/trpc/client';

const { Text, Title } = Typography;

const statusColorMap: Record<string, string> = {
  fulfilled: 'green',
  paid: 'green',
  pending: 'orange',
  succeeded: 'green',
};

const Billing = memo(() => {
  const { t } = useTranslation('subscription');

  const { data: payments, isLoading } = lambdaQuery.subscription.getPayments.useQuery();

  const showSuccess = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('payment') === 'success';
  }, []);

  const columns = useMemo(
    () => [
      {
        dataIndex: 'createdAt',
        key: 'createdAt',
        render: (val: Date) => new Date(val).toLocaleDateString('ru-RU'),
        title: t('billing.created'),
      },
      {
        dataIndex: 'type',
        key: 'type',
        render: (val: string) => (val === 'subscription' ? t('plans.subscribe') : t('funds.topUp.title')),
        title: t('usage.overview.product'),
      },
      {
        dataIndex: 'amountRub',
        key: 'amountRub',
        render: (val: number) => `${val} ₽`,
        title: t('billing.amount'),
      },
      {
        dataIndex: 'status',
        key: 'status',
        render: (val: string) => (
          <Tag color={statusColorMap[val] || 'default'}>{val === 'fulfilled' ? t('billing.paid') : val}</Tag>
        ),
        title: t('billing.status'),
      },
    ],
    [t],
  );

  if (isLoading) {
    return (
      <>
        <SettingHeader title={t('tab.billing')} />
        <Flexbox align="center" justify="center" style={{ padding: 64 }}>
          <Spin />
        </Flexbox>
      </>
    );
  }

  return (
    <>
      <SettingHeader title={t('tab.billing')} />

      {showSuccess && (
        <Alert
          closable
          showIcon
          description={t('payment.success.desc')}
          message={t('payment.success.title')}
          style={{ marginTop: 16 }}
          type="success"
        />
      )}

      <Card style={{ marginTop: 16 }}>
        <Title level={5} style={{ marginBottom: 16, marginTop: 0 }}>
          {t('billing.history')}
        </Title>

        {payments && payments.length > 0 ? (
          <Table
            columns={columns}
            dataSource={payments}
            pagination={false}
            rowKey="id"
            size="small"
          />
        ) : (
          <Flexbox align="center" justify="center" style={{ padding: 32 }}>
            <Text type="secondary">{t('billing.empty')}</Text>
          </Flexbox>
        )}
      </Card>
    </>
  );
});

Billing.displayName = 'Billing';
export default Billing;
