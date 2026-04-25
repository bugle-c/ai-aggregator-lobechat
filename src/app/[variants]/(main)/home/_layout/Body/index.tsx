'use client';

import { Accordion, Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useIsLightMode } from '@/features/UIMode';

import Agent from './Agent';
import BottomMenu from './BottomMenu';

export enum GroupKey {
  Agent = 'agent',
  Project = 'project',
}

const Body = memo(() => {
  // Hide "Агент" expandable group + persona list in Light (free) plan
  const isLight = useIsLightMode();

  return (
    <Flexbox paddingInline={4}>
      <Accordion defaultExpandedKeys={[GroupKey.Project, GroupKey.Agent]} gap={8}>
        {!isLight && <Agent itemKey={GroupKey.Agent} />}
        <BottomMenu />
      </Accordion>
    </Flexbox>
  );
});

export default Body;
