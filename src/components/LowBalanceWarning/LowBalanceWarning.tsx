'use client';

import { Flexbox } from '@lobehub/ui';
import { Alert, App, Button } from 'antd';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { selectBalanceView } from '@/business/client/balanceView';
import { creditsToHuman } from '@/business/utils/creditsToHuman';
import { lambdaQuery } from '@/libs/trpc/client';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

/** Cheapest cloud option via the `lobehub` gateway. DeepSeek V4 Flash carries
 * markupOverride=2.0 in model_rates so it's the wow-price hero. Replaces the
 * retired local gemma4:e4b (Ollama on CPU was too slow to recommend). */
const WEBGPT_MINI = { model: 'deepseek-v4.1-flash', provider: 'lobehub' } as const;

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

  const view = selectBalanceView(data);

  // EXP-003: on the free plan the binding limit is the daily message quota —
  // the monthly pool is a safety cap and must not drive the hint. Free users
  // whose purchased credits lift the gate get no hint: the badge shows the
  // exact remainder, and once it is spent the daily hint takes over.
  if (view.kind === 'purchased') return null;

  const isDaily = view.kind === 'daily';
  if (isDaily && view.remaining > 1) return null;

  const { usagePercent } = data;
  const remaining = view.remaining;
  // Soft heads-up from 50% (info), real warning from 80%; 0 case is handled by
  // the exhausted modal.
  if (!isDaily && (usagePercent < 50 || remaining <= 0)) return null;
  const isSoft = !isDaily && usagePercent < 80;

  // A cheaper model does not stretch a per-message quota — offer it only
  // when credits are the constraint.
  const isOnMini = currentModel === WEBGPT_MINI.model;
  const showSwitchMini = !isDaily && !isOnMini;

  const human = creditsToHuman(remaining);
  // Russian plural agreement for «картинка/картинки/картинок».
  const imgWord = pluralRu(human.images, ['картинка', 'картинки', 'картинок']);
  const humanStr = `≈ ${human.images} ${imgWord}`;

  const title = isDaily
    ? remaining === 0
      ? t('warning.dailyEmpty', { time: view.resetTime })
      : t('warning.dailyLast', { time: view.resetTime })
    : isSoft
      ? t('warning.halfUsed', { human: humanStr, remaining })
      : t('warning.lowBalance', { remaining });

  return (
    <Flexbox paddingBlock={'0 6px'} paddingInline={12}>
      <Alert
        closable
        showIcon
        // Buttons live in `description` (always visible). The @lobehub/ui Alert
        // hides an `extra` block behind an English «Show Details» toggle — we
        // render plain antd Alert so the CTAs are never collapsed.
        type={isSoft ? 'info' : 'warning'}
        description={
          <Flexbox gap={8} style={{ marginTop: 8 }}>
            <Flexbox horizontal gap={8} wrap="wrap">
              <Button size="small" onClick={() => navigate('/settings/subscription/funds')}>
                {t('warning.topup')}
              </Button>
              <Button size="small" type="primary" onClick={() => navigate('/settings/plans')}>
                {t('warning.upgrade')}
              </Button>
            </Flexbox>
            {showSwitchMini && (
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
        message={title}
        onClose={handleDismiss}
      />
    </Flexbox>
  );
});

/** Russian plural picker: (1) one, (2-4) few, (0/5-20/…) many. */
function pluralRu(n: number, [one, few, many]: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

LowBalanceWarning.displayName = 'LowBalanceWarning';
export default LowBalanceWarning;
