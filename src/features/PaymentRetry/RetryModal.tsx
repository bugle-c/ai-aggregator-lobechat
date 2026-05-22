'use client';

import { Modal, Typography } from 'antd';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';
import { describeReason } from '@/server/modules/billing/cancellation-reasons';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

const { Title, Text } = Typography;

const SUPPRESSED_PATHS = [/^\/settings\/plans/, /^\/admin\b/];

const RetryModal = memo(() => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const isLoaded = useUserStore(authSelectors.isLoaded);
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const [forced, setForced] = useState(false);

  useEffect(() => {
    const v = search?.get('payment');
    if (v === 'failed' || v === 'canceled') setForced(true);
  }, [search]);

  const suppressedByPath = useMemo(
    () => SUPPRESSED_PATHS.some((re) => re.test(pathname ?? '')),
    [pathname],
  );

  const { data, refetch } = lambdaQuery.topUp.getRecentFailure.useQuery(undefined, {
    enabled: !!(isLogin && isLoaded && !suppressedByPath),
    staleTime: 60_000,
  });

  const dismissed = useMemo(() => {
    if (typeof window === 'undefined' || !data) return false;
    return localStorage.getItem(`retry_modal_dismissed_${data.paymentId}`) === '1';
  }, [data]);

  const visible = !!(isLogin && isLoaded && !suppressedByPath && data && !dismissed);

  const retryMutation = lambdaQuery.topUp.recoverFromFailure.useMutation({
    onSuccess: ({ paymentUrl }) => {
      if (paymentUrl) {
        window.location.href = paymentUrl;
      }
    },
  });

  const handleClose = useCallback(() => {
    if (data?.paymentId) {
      localStorage.setItem(`retry_modal_dismissed_${data.paymentId}`, '1');
    }
    if (forced) {
      const params = new URLSearchParams(search?.toString() ?? '');
      params.delete('payment');
      router.replace(`${pathname}${params.toString() ? `?${params}` : ''}`);
      setForced(false);
    }
    refetch();
  }, [data, forced, pathname, refetch, router, search]);

  if (!visible || !data) return null;

  const reasonDesc = describeReason(data.reasonCode);
  const methodLabel =
    data.paymentMethodType === 'bank_card'
      ? `\u{1F4B3}\u{00A0}\u{00A0}${data.cardIssuerName ?? 'Карта'} \u{2022}\u{2022} ${data.cardLast4 ?? '????'}`
      : data.paymentMethodType === 'sbp'
        ? '\u{1F4F1}\u{00A0}\u{00A0}СБП'
        : '— (метод не определён)';

  return (
    <Modal
      centered
      destroyOnClose
      open
      footer={null}
      title={null}
      width={460}
      onCancel={handleClose}
    >
      <Title level={4} style={{ margin: 0 }}>
        {'💳 Платёж не прошёл'}
      </Title>
      <Text style={{ display: 'block', marginTop: 8 }}>{reasonDesc.text}</Text>
      <Text style={{ display: 'block', marginTop: 12, fontSize: 13 }} type="secondary">
        {'Метод, который не сработал:'}
      </Text>
      <Text style={{ display: 'block', marginTop: 2 }}>{methodLabel}</Text>

      <div style={{ borderTop: '1px solid #2a2a2a', margin: '20px 0' }} />

      <Text style={{ display: 'block', marginBottom: 12, fontSize: 14 }}>
        {'Попробуй '}
        <b>{'СБП'}</b>
        {
          ' — оплата через QR в банковском приложении, без 3-D Secure, проходит у 95% карт российских банков:'
        }
      </Text>

      <button
        disabled={retryMutation.isPending}
        type="button"
        style={{
          background: '#0088cc',
          border: 'none',
          borderRadius: 10,
          color: '#fff',
          cursor: retryMutation.isPending ? 'wait' : 'pointer',
          fontSize: 15,
          fontWeight: 500,
          padding: '12px 16px',
          width: '100%',
        }}
        onClick={() => retryMutation.mutate({ originalPaymentId: data.paymentId, method: 'sbp' })}
      >
        {`📱 Оплатить через СБП — ${data.amountRub} ₽`}
      </button>

      <button
        disabled={retryMutation.isPending}
        type="button"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#888',
          cursor: 'pointer',
          fontSize: 13,
          marginTop: 10,
          padding: 6,
          width: '100%',
        }}
        onClick={() => retryMutation.mutate({ originalPaymentId: data.paymentId, method: 'any' })}
      >
        {'Или попробуй другой способ →'}
      </button>

      <div style={{ borderTop: '1px solid #2a2a2a', margin: '20px 0' }} />

      <Text style={{ display: 'block', fontSize: 12 }} type="secondary">
        {'Не получается? '}
        <a
          href={`https://t.me/gptwebrubot?start=help_payment_${data.paymentId}`}
          rel="noreferrer"
          style={{ color: '#1677ff' }}
          target="_blank"
        >
          {'Напиши в бот @gptwebrubot'}
        </a>
        {' — поможем оплатить вручную.'}
      </Text>
    </Modal>
  );
});

RetryModal.displayName = 'RetryModal';
export default RetryModal;
