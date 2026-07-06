'use client';

import { ActionIcon, Avatar, Flexbox, Text } from '@lobehub/ui';
import { Menu } from 'lucide-react';
import { memo } from 'react';
import { Link } from 'react-router-dom';

import { BalanceBadge } from '@/features/Onboarding';
import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import RecentChatsButton from './RecentChatsButton';

const MobileGlobalHeader = memo(() => {
  const avatar = useUserStore((s) => s.user?.avatar);
  const name = useUserStore((s) => s.user?.fullName ?? s.user?.email ?? '');
  const isLogin = useUserStore(authSelectors.isLogin);
  const toggleLeftPanel = useGlobalStore((s) => s.toggleLeftPanel);

  return (
    <Flexbox
      horizontal
      align="center"
      gap={12}
      paddingInline={12}
      style={{
        background: 'var(--ant-color-bg-container)',
        borderBlockEnd: '1px solid var(--ant-color-border-secondary)',
        height: 56,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <ActionIcon
        aria-label="Открыть меню"
        icon={Menu}
        size="large"
        onClick={() => toggleLeftPanel(true)}
      />
      <Link
        style={{ alignItems: 'center', display: 'flex', flex: 1, gap: 6, textDecoration: 'none' }}
        to="/"
      >
        <span aria-hidden style={{ fontSize: 20 }}>
          🤯
        </span>
        <Text strong style={{ fontSize: 16 }}>
          WebGPT
        </Text>
      </Link>

      {isLogin && <RecentChatsButton />}

      <BalanceBadge />

      <Avatar avatar={avatar ?? undefined} size={32} title={name} />
    </Flexbox>
  );
});

MobileGlobalHeader.displayName = 'MobileGlobalHeader';

export default MobileGlobalHeader;
