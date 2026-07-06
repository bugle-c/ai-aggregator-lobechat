'use client';

import { AccordionItem, Flexbox, Text } from '@lobehub/ui';
import { MessageSquarePlusIcon } from 'lucide-react';
import { memo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useInitRecentTopic } from '@/hooks/useInitRecentTopic';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import RecentChatsList from './List';

interface RecentChatsProps {
  itemKey: string;
}

/**
 * Light-mode sidebar group: a "Новый чат" entry + a list of the user's recent
 * conversations, so a Light user can always start a fresh chat AND return to
 * past ones straight from the LEFT sidebar (Pro mode keeps its own Agent group).
 */
const RecentChats = memo<RecentChatsProps>(({ itemKey }) => {
  const { t } = useTranslation('chat');
  const { t: tTopic } = useTranslation('topic');
  const navigate = useNavigate();
  const { isRevalidating } = useInitRecentTopic();

  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const openNewTopicOrSaveTopic = useChatStore((s) => s.openNewTopicOrSaveTopic);

  const handleNewChat = () => {
    // Land the user on a clean inbox chat and open a fresh topic. Works from
    // anywhere (home page or an existing conversation).
    if (inboxAgentId) navigate(`/agent/${inboxAgentId}`);
    openNewTopicOrSaveTopic();
  };

  return (
    <AccordionItem
      action={isRevalidating && <NeuralNetworkLoading size={14} />}
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      title={
        <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
          {t('topic.recent')}
        </Text>
      }
    >
      <Flexbox gap={1} paddingBlock={1}>
        <NavItem
          icon={MessageSquarePlusIcon}
          title={tTopic('actions.addNewTopic')}
          onClick={handleNewChat}
        />
        <Suspense fallback={<SkeletonList rows={4} />}>
          <RecentChatsList />
        </Suspense>
      </Flexbox>
    </AccordionItem>
  );
});

export default RecentChats;
