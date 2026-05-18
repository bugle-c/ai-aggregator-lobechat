import { type FC, type ReactNode } from 'react';
import { useState } from 'react';
import { Rnd } from 'react-rnd';

import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import { ENABLE_RESIZING, MAX_WIDTH, MIN_WIDTH } from '../const';
import { usePanelHandlers } from '../hooks/usePanelHandlers';
import { usePanelSize } from '../hooks/usePanelSize';
import { usePanelState } from '../hooks/usePanelState';
import { Footer } from './Footer';
import { List } from './List';
import { Toolbar } from './Toolbar';

interface PanelContentProps {
  extraControls?: (modelId: string, providerId: string) => ReactNode;
  model?: string;
  onModelChange?: (params: { model: string; provider: string }) => Promise<void>;
  onOpenChange?: (open: boolean) => void;
  onToggleShowAll?: () => void;
  provider?: string;
  showAll?: boolean;
}

export const PanelContent: FC<PanelContentProps> = ({
  extraControls,
  model: modelProp,
  onModelChange: onModelChangeProp,
  onOpenChange,
  onToggleShowAll,
  provider: providerProp,
  showAll = false,
}) => {
  const enabledList = useEnabledChatModels();
  const [searchKeyword, setSearchKeyword] = useState('');
  const { groupMode, handleGroupModeChange } = usePanelState();
  const { panelHeight, panelWidth, handlePanelWidthChange } = usePanelSize(enabledList.length);
  const { handleClose } = usePanelHandlers({
    onModelChange: onModelChangeProp,
    onOpenChange,
  });
  const isLogin = useUserStore(authSelectors.isLogin);

  // Plan-aware recommended list. staleTime=5min — plan rarely changes
  // mid-session, and tRPC will dedupe with other consumers (CreditWidget).
  const { data: creditState } = lambdaQuery.spend.getCreditState.useQuery(undefined, {
    enabled: isLogin,
    staleTime: 5 * 60 * 1000,
  });
  const planSlug = creditState?.planSlug;

  return (
    <Rnd
      disableDragging
      enableResizing={ENABLE_RESIZING}
      maxWidth={MAX_WIDTH}
      minWidth={MIN_WIDTH}
      position={{ x: 0, y: 0 }}
      size={{ height: panelHeight, width: panelWidth }}
      style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}
      onResizeStop={(_e, _direction, ref) => {
        handlePanelWidthChange(ref.offsetWidth);
      }}
    >
      <Toolbar
        groupMode={groupMode}
        searchKeyword={searchKeyword}
        onGroupModeChange={handleGroupModeChange}
        onSearchKeywordChange={setSearchKeyword}
      />
      <List
        extraControls={extraControls}
        groupMode={groupMode}
        model={modelProp}
        planSlug={planSlug}
        provider={providerProp}
        searchKeyword={searchKeyword}
        showAll={showAll}
        onModelChange={onModelChangeProp}
        onOpenChange={onOpenChange}
        onToggleShowAll={onToggleShowAll}
      />
      <Footer onClose={handleClose} />
    </Rnd>
  );
};
