'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Drawer, Typography } from 'antd';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

const { Text, Title } = Typography;

interface Props {
  monthlyResetDate?: string | null;
  onClose: () => void;
  open: boolean;
  remainingCredits: number;
}

/**
 * Bottom-sheet shown on mobile when the user taps the BalanceBadge.
 *
 * Currently the badge just shows a number with no context — new users
 * have no idea whether 50 credits is a lot or a little. This sheet
 * explains what 1 credit buys (chat msg, image, video) and offers two
 * paths to top up: ad-hoc (Купить ещё → /settings/billing) or upgrade
 * (Перейти на Pro → /settings/subscription/plans).
 *
 * Caller controls open state (typically the BalanceBadge wrapper). On
 * first dismiss, the badge can persist a `balance_explained_seen` cookie
 * to avoid auto-opening on subsequent visits — that's caller's concern.
 */
const BalanceExplainSheet = memo<Props>(({ monthlyResetDate, onClose, open, remainingCredits }) => {
  const navigate = useNavigate();

  return (
    <Drawer
      height="auto"
      onClose={onClose}
      open={open}
      placement="bottom"
      styles={{ body: { padding: 0 }, header: { display: 'none' } }}
    >
      <Flexbox gap={10} paddingBlock={24} paddingInline={20}>
        <Title level={5} style={{ margin: 0 }}>
          Что такое кредит?
        </Title>
        <Text type="secondary">1 кредит ≈ 1 короткое сообщение GPT-5-mini</Text>
        <Text type="secondary">5 кредитов = 1 картинка Flux</Text>
        <Text type="secondary">50 кредитов = 1 картинка Nano Banana Pro</Text>
        <Text type="secondary">200 кредитов = 1 минута видео Seedance</Text>
        <Text style={{ marginBlockStart: 12 }}>У вас {remainingCredits} кредитов.</Text>
        {monthlyResetDate && (
          <Text type="secondary">Бесплатные кредиты обновятся {monthlyResetDate}.</Text>
        )}
        <Button
          block
          onClick={() => {
            onClose();
            navigate('/settings/billing?utm_source=balance_sheet');
          }}
          type="default"
        >
          Купить ещё
        </Button>
        <Button
          block
          onClick={() => {
            onClose();
            navigate('/settings/subscription/plans?utm_source=balance_sheet');
          }}
          size="large"
          type="primary"
        >
          Перейти на Pro
        </Button>
      </Flexbox>
    </Drawer>
  );
});

BalanceExplainSheet.displayName = 'BalanceExplainSheet';

export default BalanceExplainSheet;
