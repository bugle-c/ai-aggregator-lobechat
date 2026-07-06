'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useIsLightMode } from '@/features/UIMode';

import Agent from './Agent';
import BottomMenu from './BottomMenu';
import RecentChats from './RecentChats';

export enum GroupKey {
  Agent = 'agent',
  Project = 'project',
  RecentChats = 'recentChats',
}

const Body = memo(() => {
  // Light (free) plan hides the "Агент" persona group. Instead we surface a
  // "recent chats" group so Light users can start a new chat and return to
  // past conversations straight from the sidebar. Pro mode keeps the Agent group.
  const isLight = useIsLightMode();

  return (
    <Flexbox paddingInline={4}>
      <Accordion
        defaultExpandedKeys={[GroupKey.Project, GroupKey.Agent, GroupKey.RecentChats]}
        gap={8}
      >
        {isLight ? (
          <RecentChats itemKey={GroupKey.RecentChats} />
        ) : (
          <Agent itemKey={GroupKey.Agent} />
        )}
        <BottomMenu />
      </Accordion>
    </Flexbox>
  );
});

export default Body;
