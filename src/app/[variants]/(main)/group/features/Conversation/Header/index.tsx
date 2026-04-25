'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, Suspense } from 'react';

import NavHeader from '@/features/NavHeader';
import { BalanceBadge } from '@/features/Onboarding';
import { UIModeToggle } from '@/features/UIMode';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';

import ShareButton from './ShareButton';

const Header = memo(() => {
  return (
    <NavHeader
      right={
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          style={{ backgroundColor: cssVar.colorBgContainer }}
        >
          <UIModeToggle />
          <BalanceBadge />
          <WideScreenButton />
          <Suspense>
            <ShareButton />
          </Suspense>
        </Flexbox>
      }
    />
  );
});

export default Header;
