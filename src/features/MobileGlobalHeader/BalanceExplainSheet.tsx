'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Drawer, Typography } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { type BalanceView } from '@/business/client/balanceView';

const { Text, Title } = Typography;

interface Props {
  onClose: () => void;
  open: boolean;
  view: BalanceView;
}

/**
 * Bottom-sheet shown on mobile when the user taps the BalanceBadge.
 *
 * Currently the badge just shows a number with no context — new users
 * have no idea whether 50 credits is a lot or a little. This sheet
 * explains what 1 credit buys (chat msg, image, video) and offers two
 * paths to top up: ad-hoc (Купить ещё → /settings/funds) or upgrade
 * (Перейти на Pro → /settings/plans).
 *
 * The «what you have» line follows the badge variant (EXP-003): free users
 * see today's message allowance, not the monthly credit cap.
 *
 * Caller controls open state (typically the BalanceBadge wrapper). On
 * first dismiss, the badge can persist a `balance_explained_seen` cookie
 * to avoid auto-opening on subsequent visits — that's caller's concern.
 */
const BalanceExplainSheet = memo<Props>(({ onClose, open, view }) => {
  const { t } = useTranslation('subscription');
  const navigate = useNavigate();

  const status =
    view.kind === 'daily'
      ? t('freeQuota.today', {
          quota: view.quota,
          remaining: view.remaining,
          time: view.resetTime,
        })
      : view.kind === 'purchased'
        ? t('freeQuota.purchased', { count: view.remaining })
        : `У вас ${view.remaining} кредитов.`;

  return (
    <Drawer
      height="auto"
      open={open}
      placement="bottom"
      styles={{ body: { padding: 0 }, header: { display: 'none' } }}
      onClose={onClose}
    >
      <Flexbox gap={10} paddingBlock={24} paddingInline={20}>
        <Title level={5} style={{ margin: 0 }}>
          Что такое кредит?
        </Title>
        <Text type="secondary">1 кредит ≈ 1 короткое сообщение GPT-5-mini</Text>
        <Text type="secondary">5 кредитов = 1 картинка Flux</Text>
        <Text type="secondary">50 кредитов = 1 картинка Nano Banana Pro</Text>
        <Text type="secondary">200 кредитов = 1 минута видео Seedance</Text>
        <Text style={{ marginBlockStart: 12 }}>{status}</Text>
        <Button
          block
          type="default"
          onClick={() => {
            onClose();
            // /settings/funds is the top-up page; /settings/billing is
            // payment HISTORY — the CTA's intent is "buy more credits".
            navigate('/settings/funds?utm_source=balance_sheet');
          }}
        >
          Купить ещё
        </Button>
        <Button
          block
          size="large"
          type="primary"
          onClick={() => {
            onClose();
            navigate('/settings/plans?utm_source=balance_sheet');
          }}
        >
          Перейти на Pro
        </Button>
      </Flexbox>
    </Drawer>
  );
});

BalanceExplainSheet.displayName = 'BalanceExplainSheet';

export default BalanceExplainSheet;
