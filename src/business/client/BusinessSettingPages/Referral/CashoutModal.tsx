'use client';

import { App, Form, Input, InputNumber, Modal, Select, Typography } from 'antd';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';

const { Text } = Typography;

interface CashoutModalProps {
  /** Current credit balance available for cashout. */
  balance: number;
  /** Minimum credits per request from server config. */
  minCredits: number;
  /** Called after the user closes the modal (cancel or submit-success). */
  onClose: () => void;
  /** Called on successful submission so parent can refresh queries. */
  onSuccess: () => void;
  open: boolean;
  /** RUB rate per credit from server config. */
  ratePerCredit: number;
}

type Method = 'card' | 'sbp' | 'sber';

interface FormValues {
  creditsRequested: number;
  paymentDetails: string;
  paymentMethod: Method;
}

const CashoutModal = memo<CashoutModalProps>(
  ({ open, onClose, onSuccess, balance, minCredits, ratePerCredit }) => {
    const { t } = useTranslation('subscription');
    const { message } = App.useApp();
    const [form] = Form.useForm<FormValues>();
    const [creditsValue, setCreditsValue] = useState<number>(0);

    // Default the amount to the current balance, capped at a sane initial state.
    // Re-runs each time the modal opens so that recent earnings are reflected.
    useEffect(() => {
      if (open) {
        const initial = Math.max(balance, minCredits);
        form.setFieldsValue({
          creditsRequested: balance >= minCredits ? balance : initial,
          paymentDetails: '',
          paymentMethod: 'card',
        });
        setCreditsValue(balance >= minCredits ? balance : initial);
      }
    }, [open, balance, minCredits, form]);

    const mutation = lambdaQuery.referral.requestCashout.useMutation({
      onError: (err) => {
        const msg = err.message?.includes('Insufficient')
          ? t('referrals.cashout.errorBalance')
          : err.message || 'Error';
        message.error(msg);
      },
      onSuccess: () => {
        message.success(t('referrals.cashout.successToast'));
        onSuccess();
        onClose();
      },
    });

    const methodOptions = useMemo(
      () => [
        { label: t('referrals.cashout.methodCard'), value: 'card' as Method },
        { label: t('referrals.cashout.methodSbp'), value: 'sbp' as Method },
        { label: t('referrals.cashout.methodSber'), value: 'sber' as Method },
      ],
      [t],
    );

    const placeholderForMethod = (m: Method): string => {
      if (m === 'sbp') return t('referrals.cashout.detailsPlaceholderSbp');
      if (m === 'sber') return t('referrals.cashout.detailsPlaceholderSber');
      return t('referrals.cashout.detailsPlaceholderCard');
    };

    const handleOk = async () => {
      const values = await form.validateFields();
      mutation.mutate({
        creditsRequested: values.creditsRequested,
        paymentDetails: values.paymentDetails,
        paymentMethod: values.paymentMethod,
      });
    };

    const rubEquivalent = Math.round(creditsValue * ratePerCredit);
    const minRub = Math.round(minCredits * ratePerCredit);

    return (
      <Modal
        destroyOnHidden
        cancelText={t('referrals.cashout.cancel')}
        confirmLoading={mutation.isPending}
        okText={t('referrals.cashout.submit')}
        open={open}
        title={t('referrals.cashout.modalTitle')}
        onCancel={onClose}
        onOk={handleOk}
      >
        <Form
          form={form}
          initialValues={{ paymentMethod: 'card' }}
          layout="vertical"
          onValuesChange={(_, all) => {
            if (typeof all.creditsRequested === 'number') {
              setCreditsValue(all.creditsRequested);
            }
          }}
        >
          <Text style={{ display: 'block', marginBottom: 8 }} type="secondary">
            {t('referrals.cashout.rate', { rate: ratePerCredit })} ·{' '}
            {t('referrals.cashout.minimum', { min: minCredits, minRub })}
          </Text>
          <Text style={{ display: 'block', marginBottom: 16 }} type="secondary">
            {t('referrals.cashout.balance', { balance })}
          </Text>

          <Form.Item
            extra={t('referrals.cashout.amountHint', { rub: rubEquivalent })}
            label={t('referrals.cashout.amount')}
            name="creditsRequested"
            rules={[
              { required: true, message: t('referrals.cashout.errorMinimum', { min: minCredits }) },
              {
                validator: (_, value: number) => {
                  if (typeof value !== 'number') return Promise.resolve();
                  if (value < minCredits) {
                    return Promise.reject(
                      new Error(t('referrals.cashout.errorMinimum', { min: minCredits })),
                    );
                  }
                  if (value > balance) {
                    return Promise.reject(new Error(t('referrals.cashout.errorBalance')));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <InputNumber max={balance} min={minCredits} step={100} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            label={t('referrals.cashout.method')}
            name="paymentMethod"
            rules={[{ required: true }]}
          >
            <Select options={methodOptions} />
          </Form.Item>

          <Form.Item noStyle shouldUpdate>
            {() => {
              const method = (form.getFieldValue('paymentMethod') as Method) || 'card';
              return (
                <Form.Item
                  label={t('referrals.cashout.details')}
                  name="paymentDetails"
                  rules={[
                    { required: true, message: t('referrals.cashout.details') },
                    { max: 256 },
                  ]}
                >
                  <Input placeholder={placeholderForMethod(method)} />
                </Form.Item>
              );
            }}
          </Form.Item>
        </Form>
      </Modal>
    );
  },
);

CashoutModal.displayName = 'CashoutModal';
export default CashoutModal;
