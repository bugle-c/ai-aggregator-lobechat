'use client';

import { Avatar, Flexbox, Markdown, Text } from '@lobehub/ui';
import { Button, Progress } from 'antd';
import isEqual from 'fast-deep-equal';
import React, { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { selectBalanceView } from '@/business/client/balanceView';
import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { useIsMobile } from '@/hooks/useIsMobile';
import { lambdaQuery } from '@/libs/trpc/client';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import OpeningQuestions from './OpeningQuestions';
import ToolAuthAlert from './ToolAuthAlert';

const InboxWelcome = memo(() => {
  const { t } = useTranslation(['welcome', 'chat', 'subscription']);
  const mobile = useIsMobile();
  const isLogin = useUserStore(authSelectors.isLogin);
  const { data: creditState } = lambdaQuery.spend.getCreditState.useQuery(undefined, {
    enabled: isLogin,
  });
  const navigate = useNavigate();
  const isInbox = useAgentStore(builtinAgentSelectors.isInboxAgent);
  const openingQuestions = useAgentStore(agentSelectors.openingQuestions, isEqual);
  const fontSize = useUserStore(userGeneralSettingsSelectors.fontSize);
  const meta = useAgentStore(agentSelectors.currentAgentMeta, isEqual);

  const agentSystemRoleMsg = t('agentDefaultMessageWithSystemRole', {
    name: meta.title || t('defaultAgent', { ns: 'chat' }),
    ns: 'chat',
  });
  const openingMessage = useAgentStore(agentSelectors.openingMessage);

  const message = useMemo(() => {
    if (openingMessage) return openingMessage;
    return agentSystemRoleMsg;
  }, [openingMessage, agentSystemRoleMsg, meta.description]);

  const displayTitle = isInbox ? 'WebGPT' : meta.title || t('defaultSession', { ns: 'common' });

  // EXP-003: free users see today's message allowance, not «2464 / 2500
  // кредитов» — the monthly cap is a safety net they never get to spend.
  const balance = creditState ? selectBalanceView(creditState) : null;
  const balanceLine =
    balance && creditState
      ? balance.kind === 'daily'
        ? t('freeQuota.welcome', {
            ns: 'subscription',
            plan: creditState.planName,
            quota: balance.quota,
            remaining: balance.remaining,
          })
        : balance.kind === 'purchased'
          ? t('freeQuota.welcomePurchased', {
              count: balance.remaining,
              ns: 'subscription',
              plan: creditState.planName,
            })
          : `${creditState.planName}: ${balance.remaining} / ${balance.total} кредитов`
      : null;
  const balancePercent =
    balance?.kind === 'daily'
      ? Math.round((balance.used / balance.quota) * 100)
      : balance?.kind === 'credits'
        ? creditState!.usagePercent
        : null;

  return (
    <>
      <Flexbox flex={1} />
      <Flexbox
        gap={12}
        width={'100%'}
        style={{
          paddingBottom: 'max(10vh, 32px)',
        }}
      >
        <Avatar
          avatar={isInbox ? DEFAULT_INBOX_AVATAR : meta.avatar || DEFAULT_AVATAR}
          background={meta.backgroundColor}
          shape={'square'}
          size={78}
        />
        <Text fontSize={32} weight={'bold'}>
          {displayTitle}
        </Text>
        <Flexbox width={'min(100%, 640px)'}>
          <Markdown fontSize={fontSize} variant={'chat'}>
            {isInbox ? t('guide.defaultMessageWithoutCreate', { appName: 'WebGPT' }) : message}
          </Markdown>
        </Flexbox>
        {creditState && (
          <Flexbox
            gap={8}
            padding={16}
            style={{
              background: 'var(--lobe-color-fill-secondary)',
              borderRadius: 12,
              maxWidth: 400,
            }}
          >
            <Flexbox horizontal align="center" justify="space-between">
              <Text style={{ fontSize: 13 }}>{balanceLine}</Text>
            </Flexbox>
            {balancePercent !== null && (
              <Progress
                percent={balancePercent}
                showInfo={false}
                size="small"
                strokeColor={
                  balancePercent > 90 ? '#ff4d4f' : balancePercent > 70 ? '#faad14' : '#1677ff'
                }
              />
            )}
            {creditState.nextPlanName && (
              <Flexbox horizontal align="center" gap={8}>
                <Text style={{ fontSize: 12 }} type="secondary">
                  {creditState.nextPlanName} за {creditState.nextPlanPrice} ₽ —{' '}
                  {creditState.nextPlanCredits} кредитов/мес
                </Text>
                <Button size="small" onClick={() => navigate('/settings/plans')}>
                  Подробнее
                </Button>
              </Flexbox>
            )}
          </Flexbox>
        )}
        {openingQuestions.length > 0 && (
          <OpeningQuestions mobile={mobile} questions={openingQuestions} />
        )}
        <ToolAuthAlert />
      </Flexbox>
    </>
  );
});

export default InboxWelcome;
