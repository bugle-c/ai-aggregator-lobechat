'use client';

import { Alert, Flexbox } from '@lobehub/ui';
import { App, Button } from 'antd';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { lambdaQuery } from '@/libs/trpc/client';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

/** WebGPT Mini — the cheapest cloud model, served via the `lobehub` gateway. */
const WEBGPT_MINI = { model: 'gemma4:e4b', provider: 'lobehub' } as const;

const LowBalanceWarning = memo(() => {
  const { t } = useTranslation('subscription');
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const isLogin = useUserStore(authSelectors.isLogin);
  const currentModel = useAgentStore(agentSelectors.currentAgentModel);

  const { data } = lambdaQuery.spend.getCreditState.useQuery(undefined, {
    enabled: isLogin,
    refetchInterval: 60_000,
  });

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  // Secondary option: downgrade the active agent to the cheap WebGPT Mini so the
  // remaining credits stretch much further. Client-only — reuses the same
  // model-switch path as the Light-mode reset. Upgrade/top-up stay primary.
  const handleSwitchToMini = useCallback(async () => {
    const store = useAgentStore.getState();
    const agentId = store.activeAgentId;
    if (!agentId) return;
    await store.updateAgentConfigById(agentId, { ...WEBGPT_MINI });
    message.success(t('warning.switchedToMini'));
    setDismissed(true);
  }, [message, t]);

  if (!data || dismissed) return null;

  const { creditsUsed, totalAvailable, usagePercent } = data;
  const remaining = totalAvailable - creditsUsed;

  // Only show when 80-100% used and credits > 0 (modal handles 0 case)
  if (usagePercent < 80 || remaining <= 0) return null;

  const isOnMini = currentModel === WEBGPT_MINI.model;

  return (
    <Flexbox paddingBlock={'0 6px'} paddingInline={12}>
      <Alert
        closable
        title={t('warning.lowBalance', { remaining })}
        type={'warning'}
        extra={
          <Flexbox gap={6} style={{ marginTop: 8 }}>
            <Flexbox horizontal gap={8}>
              <Button size="small" onClick={() => navigate('/settings/subscription/funds')}>
                {t('warning.topup')}
              </Button>
              <Button size="small" type="primary" onClick={() => navigate('/settings/plans')}>
                {t('warning.upgrade')}
              </Button>
            </Flexbox>
            {!isOnMini && (
              <Button
                size="small"
                style={{ height: 'auto', padding: 0, textAlign: 'start' }}
                type="link"
                onClick={handleSwitchToMini}
              >
                {t('warning.switchMini')}
              </Button>
            )}
          </Flexbox>
        }
        onClose={handleDismiss}
      />
    </Flexbox>
  );
});

LowBalanceWarning.displayName = 'LowBalanceWarning';
export default LowBalanceWarning;
