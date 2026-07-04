import { memo } from 'react';

import SideBarLayout from '@/features/NavPanel/SideBarLayout';

import Body from './Body';
import { AgentModalProvider } from './Body/Agent/ModalProvider';
import Footer from './Footer';
import Header from './Header';

const Sidebar = memo(() => {
  return (
    <AgentModalProvider>
      {/* SideBarLayout already renders the TG-link PcSidebarCard above the
          footer, so we must NOT add another one here — passing it in the
          footer duplicated the +100кр nag in the sidebar. */}
      <SideBarLayout body={<Body />} footer={<Footer />} header={<Header />} />
    </AgentModalProvider>
  );
});

export default Sidebar;
