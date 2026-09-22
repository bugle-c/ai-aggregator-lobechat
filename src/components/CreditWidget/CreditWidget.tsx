'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Progress, Typography } from 'antd';
import { Zap } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { selectBalanceView } from '@/business/client/balanceView';
import { lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

const { Text } = Typography;

const strokeFor = (percent: number) =>
  percent > 90 ? '#ff4d4f' : percent > 70 ? '#faad14' : '#1677ff';

/**
 * Sidebar plan card. Free plan (EXP-003) shows «Старт · 5 сообщений в день»
 * with today's usage as the bar; with purchased credits lifting the daily
 * gate it shows the purchased remainder and no bar (the monthly pool is a
 * safety cap, not a budget). Paid plans keep the monthly credit bar.
 */
const CreditWidget = memo(() => {
  const { t } = useTranslation('subscription');
  const navigate = useNavigate();
  const isLogin = useUserStore(authSelectors.isLogin);

  // Skip query for unauthenticated users — endpoint returns 401 and spams
  // console; the widget is hidden anyway when isLogin is false.
  const { data, isLoading } = lambdaQuery.spend.getCreditState.useQuery(undefined, {
    enabled: isLogin,
    refetchInterval: 60_000,
  });

  if (isLoading || !data) return null;

  const { planName, usagePercent, planSlug } = data;
  const view = selectBalanceView(data);

  const title =
    view.kind === 'daily' ? t('widget.dailyTitle', { plan: planName, quota: view.quota }) : planName;
  const counter =
    view.kind === 'daily'
      ? `${view.used} / ${view.quota}`
      : view.kind === 'purchased'
        ? t('widget.purchased', { count: view.remaining })
        : `${view.remaining} / ${view.total}`;
  const percent =
    view.kind === 'daily'
      ? Math.round((view.used / view.quota) * 100)
      : view.kind === 'credits'
        ? usagePercent
        : null;

  return (
    <Flexbox
      gap={4}
      padding={'8px 12px'}
      style={{
        borderRadius: 8,
        borderTop: '1px solid var(--lobe-color-border)',
        cursor: 'pointer',
      }}
      onClick={() => navigate('/settings/plans')}
    >
      <Flexbox horizontal align="center" gap={6} justify="space-between">
        <Flexbox horizontal align="center" gap={4}>
          <Icon icon={Zap} size={14} />
          <Text style={{ fontSize: 12 }} type="secondary">
            {title}
          </Text>
        </Flexbox>
        <Text style={{ fontSize: 12 }} type="secondary">
          {counter}
        </Text>
      </Flexbox>
      {percent !== null && (
        <Progress percent={percent} showInfo={false} size="small" strokeColor={strokeFor(percent)} />
      )}
      {planSlug !== 'pro' && (
        <Text style={{ fontSize: 11 }} type="secondary">
          {t('widget.upgrade')}
        </Text>
      )}
    </Flexbox>
  );
});

CreditWidget.displayName = 'CreditWidget';
export default CreditWidget;
