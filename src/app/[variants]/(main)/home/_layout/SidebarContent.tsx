import { memo } from 'react';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import { PcSidebarCard } from '@/features/TgLinkBonusBanner';

import Body from './Body';
import { AgentModalProvider } from './Body/Agent/ModalProvider';
import Footer from './Footer';
import Header from './Header';

const Sidebar = memo(() => {
  return (
    <AgentModalProvider>
      <SideBarLayout
        body={<Body />}
        // PcSidebarCard is a +100 кр TG-link nag that lives just above
        // the existing action-icon Footer. It self-gates via useShouldShow
        // (logged-in + not-linked + not-dismissed-in-7d), so anonymous
        // visitors and already-linked users see nothing. The mobile sticky
        // variant ships separately from TgLinkBonusGlobal in _layout/index.
        header={<Header />}
        footer={
          <>
            <PcSidebarCard />
            <Footer />
          </>
        }
      />
    </AgentModalProvider>
  );
});

export default Sidebar;
