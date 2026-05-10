'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC } from 'react';
import { Outlet, useSearchParams } from 'react-router-dom';

import RegisterHotkeys from './RegisterHotkeys';
import Sidebar from './Sidebar';
import { styles } from './style';
import TopicSidebar from './TopicSidebar';

const Layout: FC = () => {
  const [params] = useSearchParams();
  const newFlow = params.get('new_flow') === '1';

  if (newFlow) {
    // New flow page renders its own FlowSidebar + main area from
    // index.tsx; legacy Sidebar/TopicSidebar are skipped.
    return (
      <>
        <Outlet />
        <RegisterHotkeys />
      </>
    );
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
      <RegisterHotkeys />
    </>
  );
};

export default Layout;
