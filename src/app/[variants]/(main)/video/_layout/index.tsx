'use client';

import { Flexbox } from '@lobehub/ui';
import type { FC } from 'react';
import { Outlet, useSearchParams } from 'react-router-dom';

import Sidebar from './Sidebar';
import { styles } from './style';
import TopicSidebar from './TopicSidebar';

const Layout: FC = () => {
  const [params] = useSearchParams();
  const newFlow = params.get('new_flow') === '1';

  if (newFlow) {
    // New flow page renders FlowSidebar + FlowMainArea inside index.tsx;
    // legacy Sidebar/TopicSidebar are skipped.
    return <Outlet />;
  }

  return (
    <>
      <Sidebar />
      <Flexbox horizontal className={styles.mainContainer} flex={1} height={'100%'}>
        <Flexbox className={styles.contentContainer} flex={1} height={'100%'}>
          <Outlet />
        </Flexbox>
        <TopicSidebar />
      </Flexbox>
    </>
  );
};

export default Layout;
