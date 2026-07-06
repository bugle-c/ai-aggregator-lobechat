'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

interface PaymentTrustBadgesProps {
  /**
   * Which checkout surface this strip sits on. Subscriptions DO auto-renew
   * (renew-due-subscriptions cron charges the saved YooKassa method), so the
   * «без автосписаний» promise is only honest on one-time top-ups.
   */
  variant: 'subscription' | 'topup';
}

/**
 * Trust strip under checkout surfaces. The #1 stated payment objection across
 * all five onboarding personas is fear of hidden auto-charges — say the true
 * thing for each surface instead of leaving it unsaid.
 */
const PaymentTrustBadges = memo<PaymentTrustBadgesProps>(({ variant }) => (
  <Flexbox
    gap={4}
    style={{
      color: 'var(--ant-color-text-tertiary)',
      fontSize: 12,
      lineHeight: 1.6,
      marginTop: 16,
    }}
  >
    <span>
      {variant === 'topup'
        ? '✅ Разовый платёж — без автосписаний и скрытых продлений'
        : '✅ Отменить подписку можно в любой момент — в один клик в настройках'}
    </span>
    <span>🏦 Оплата через ЮKassa: СБП, карты Мир/Visa/MC · чек на почту</span>
    <span>ИП Верстин П.С. · ИНН 333412952925 · поддержка hello@gptweb.ru</span>
  </Flexbox>
));

PaymentTrustBadges.displayName = 'PaymentTrustBadges';

export default PaymentTrustBadges;
