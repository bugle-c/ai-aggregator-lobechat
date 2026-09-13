'use client';

import { Flexbox } from '@lobehub/ui';
import { Typography } from 'antd';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

const { Text } = Typography;

/**
 * EXP-003: «Осталось сегодня: 3 из 5» under the chat input for free-plan
 * users. Reads the same `spend.getCreditState` query as BalanceBadge (shared
 * react-query cache) and refetches when a generation finishes, so the count
 * drops right after the answer streams in. Renders nothing on paid plans
 * (`dailyQuota` is null there).
 */
const DailyQuotaCounter = memo(() => {
  const { t } = useTranslation('subscription');
  const isLogin = useUserStore(authSelectors.isLogin);

  const { data, refetch } = lambdaQuery.spend.getCreditState.useQuery(undefined, {
    enabled: isLogin,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const isGenerating = useChatStore(operationSelectors.isAgentRuntimeRunning);
  const wasGeneratingRef = useRef(isGenerating);
  useEffect(() => {
    if (wasGeneratingRef.current && !isGenerating) refetch();
    wasGeneratingRef.current = isGenerating;
  }, [isGenerating, refetch]);

  if (!isLogin || !data || data.dailyQuota == null || data.dailyRemaining == null) return null;

  const { dailyQuota, dailyRemaining } = data;

  return (
    <Flexbox paddingBlock={'0 4px'} paddingInline={12}>
      <Text style={{ fontSize: 12 }} type={dailyRemaining === 0 ? 'warning' : 'secondary'}>
        {t('dailyQuota.remaining', { quota: dailyQuota, remaining: dailyRemaining })}
      </Text>
    </Flexbox>
  );
});

DailyQuotaCounter.displayName = 'DailyQuotaCounter';

export default DailyQuotaCounter;
