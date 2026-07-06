'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from 'antd';
import { memo } from 'react';

import { reachGoal } from '@/business/client/analytics/ym';
import { messageStateSelectors, useConversationStore } from '@/features/Conversation/store';
import { lambdaQuery } from '@/libs/trpc/client';
import { useChatStore } from '@/store/chat';
import { displayMessageSelectors } from '@/store/chat/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

/**
 * Follow-up action chips under the LAST assistant message for the onboarding
 * cohort (intent set). Each chip sends a canned refinement prompt through the
 * normal conversation send action, teaching the "iterate on the answer" habit.
 * Hidden once the user has written >= 4 messages in the topic — by then they
 * are engaged and the chips would just nag. Copy is intentionally hardcoded
 * Russian — business component, RU-only product surface (same as
 * MagicImageExtra).
 */
const CHIPS: { label: string; prompt: string }[] = [
  { label: 'Покороче', prompt: 'Сделай покороче' },
  { label: 'Другой тон', prompt: 'Перепиши в другом тоне — более живом' },
  { label: 'Ещё вариант', prompt: 'Дай ещё один вариант' },
];

interface FollowUpChipsProps {
  id: string;
}

const FollowUpChips = memo<FollowUpChipsProps>(({ id }) => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const lastMessageId = useChatStore(displayMessageSelectors.lastDisplayMessageId);
  const userMessageCount = useChatStore(
    (s) => displayMessageSelectors.activeDisplayMessages(s).filter((m) => m.role === 'user').length,
  );

  const sendMessage = useConversationStore((s) => s.sendMessage);
  const isAIGenerating = useConversationStore(messageStateSelectors.isAIGenerating);

  const isLast = id === lastMessageId;
  const baseGate = isLogin && isLast && userMessageCount < 4;

  // Onboarding cohort only: users that picked an intent chip.
  const { data: onboarding } = lambdaQuery.userOnboarding.getOnboardingState.useQuery(undefined, {
    enabled: baseGate,
  });

  if (!baseGate || !onboarding?.intent) return null;

  return (
    <Flexbox horizontal gap={8} wrap={'wrap'}>
      {CHIPS.map((chip) => (
        <Button
          disabled={isAIGenerating}
          key={chip.label}
          size="small"
          onClick={() => {
            reachGoal('chip_click', { intent: 'followup' });
            void sendMessage({ message: chip.prompt });
          }}
        >
          {chip.label}
        </Button>
      ))}
    </Flexbox>
  );
});

FollowUpChips.displayName = 'FollowUpChips';

export default FollowUpChips;
