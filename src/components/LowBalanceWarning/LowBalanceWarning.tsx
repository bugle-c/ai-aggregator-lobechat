'use client';

import { Alert, Flexbox } from '@lobehub/ui';
import { Button } from 'antd';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { lambdaQuery } from '@/libs/trpc/client';

const LowBalanceWarning = memo(() => {
  const { t } = useTranslation('subscription');
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  const { data } = lambdaQuery.spend.getCreditState.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  if (!data || dismissed) return null;

  const { creditsUsed, totalAvailable, usagePercent } = data;
  const remaining = totalAvailable - creditsUsed;

  // Only show when 80-100% used and credits > 0 (modal handles 0 case)
  if (usagePercent < 80 || remaining <= 0) return null;

  return (
    <Flexbox paddingBlock={'0 6px'} paddingInline={12}>
      <Alert
        closable
        title={t('warning.lowBalance', { remaining })}
        type={'warning'}
        extra={
          <Flexbox horizontal gap={8} style={{ marginTop: 8 }}>
            <Button size="small" onClick={() => navigate('/settings/subscription/funds')}>
              {t('warning.topup')}
            </Button>
            <Button size="small" type="primary" onClick={() => navigate('/settings/plans')}>
              {t('warning.upgrade')}
            </Button>
          </Flexbox>
        }
        onClose={handleDismiss}
      />
    </Flexbox>
  );
});

LowBalanceWarning.displayName = 'LowBalanceWarning';
export default LowBalanceWarning;
