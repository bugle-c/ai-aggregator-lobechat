import { ActionIcon, DropdownMenu, Flexbox } from '@lobehub/ui';
import { CreateBotIcon } from '@lobehub/ui/icons';
import { cssVar } from 'antd-style';
import { ChevronDownIcon, MessageSquarePlusIcon } from 'lucide-react';
import React, { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useIsLightMode } from '@/features/UIMode';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';

import { useCreateMenuItems } from '../../hooks';

const AddButton = memo(() => {
  const { t: tChat } = useTranslation('chat');
  const { t: tTopic } = useTranslation('topic');
  const isLight = useIsLightMode();
  const navigate = useNavigate();

  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const openNewTopicOrSaveTopic = useChatStore((s) => s.openNewTopicOrSaveTopic);

  // Create menu items
  const {
    createAgentMenuItem,
    createGroupChatMenuItem,
    createPageMenuItem,
    createAgent,
    isMutatingAgent,
    isCreatingGroup,
  } = useCreateMenuItems();

  const handleMainIconClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      createAgent();
    },
    [createAgent],
  );

  const handleNewChatClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      // Light users have no agent/group/page creation — just a fresh chat.
      if (inboxAgentId) navigate(`/agent/${inboxAgentId}`);
      openNewTopicOrSaveTopic();
    },
    [inboxAgentId, navigate, openNewTopicOrSaveTopic],
  );

  const dropdownItems = useMemo(() => {
    return [createAgentMenuItem(), createGroupChatMenuItem(), createPageMenuItem()];
  }, [createAgentMenuItem, createGroupChatMenuItem, createPageMenuItem]);

  // Light mode: single "new chat" action (no Pro create-agent/group/page dropdown).
  if (isLight)
    return (
      <ActionIcon
        icon={MessageSquarePlusIcon}
        size={DESKTOP_HEADER_ICON_SIZE}
        title={tTopic('actions.addNewTopic')}
        onClick={handleNewChatClick}
      />
    );

  return (
    <Flexbox horizontal>
      <ActionIcon
        icon={CreateBotIcon}
        loading={isMutatingAgent || isCreatingGroup}
        size={DESKTOP_HEADER_ICON_SIZE}
        title={tChat('newAgent')}
        onClick={handleMainIconClick}
      />
      <DropdownMenu items={dropdownItems}>
        <ActionIcon
          color={cssVar.colorTextQuaternary}
          icon={ChevronDownIcon}
          size={{ blockSize: 32, size: 14 }}
          style={{
            width: 16,
          }}
        />
      </DropdownMenu>
    </Flexbox>
  );
});

export default AddButton;
