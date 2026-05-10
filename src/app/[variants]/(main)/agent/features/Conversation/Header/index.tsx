'use client';

import { isDesktop } from '@lobechat/const';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ArrowLeft } from 'lucide-react';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

import NavHeader from '@/features/NavHeader';
import { useIsMobile } from '@/hooks/useIsMobile';

import HeaderActions from './HeaderActions';
import NotebookButton from './NotebookButton';
import ShareButton from './ShareButton';
import Tags from './Tags';
import WorkingDirectory from './WorkingDirectory';

const Header = memo(() => {
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  return (
    <NavHeader
      // Desktop keeps the toggle-left-panel button. Inside a chat thread
      // on mobile we hide the global header (per `useShowTabBar`), so we
      // need an explicit back-arrow to return to home — the toggle
      // button is otherwise the only nav and it points the wrong place
      // (opens the burger drawer, not back).
      showTogglePanelButton={!isMobile}
      left={
        <Flexbox horizontal align={'center'} style={{ backgroundColor: cssVar.colorBgContainer }}>
          {isMobile && (
            <ActionIcon
              aria-label="Назад"
              icon={ArrowLeft}
              size="normal"
              onClick={() => navigate('/')}
            />
          )}
          <Tags />
        </Flexbox>
      }
      right={
        <Flexbox horizontal align={'center'} style={{ backgroundColor: cssVar.colorBgContainer }}>
          {isDesktop && <WorkingDirectory />}
          <NotebookButton />
          <ShareButton />
          <HeaderActions />
        </Flexbox>
      }
    />
  );
});

export default Header;
