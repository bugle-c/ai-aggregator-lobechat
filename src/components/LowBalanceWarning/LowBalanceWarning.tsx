'use client';

import { Alert, Flexbox } from '@lobehub/ui';
import { App, Button } from 'antd';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { creditsToHuman } from '@/business/utils/creditsToHuman';
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

  // Soft heads-up from 50% (info), real warning from 80%; 0 case is handled by
  // the exhausted modal.
  if (usagePercent < 50 || remaining <= 0) return null;
  const isSoft = usagePercent < 80;

  const isOnMini = currentModel === WEBGPT_MINI.model;
  const human = creditsToHuman(remaining);

  return (
    <Flexbox paddingBlock={'0 6px'} paddingInline={12}>
      <Alert
        closable
        type={isSoft ? 'info' : 'warning'}
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
        title={
          isSoft
            ? t('warning.halfUsed', { images: human.images, remaining })
            : t('warning.lowBalance', { remaining })
        }
        onClose={handleDismiss}
      />
    </Flexbox>
  );
});

LowBalanceWarning.displayName = 'LowBalanceWarning';
export default LowBalanceWarning;
