'use client';

import { ActionIcon, Avatar, Flexbox, Text } from '@lobehub/ui';
import { Menu } from 'lucide-react';
import Link from 'next/link';
import { memo } from 'react';

import { BalanceBadge } from '@/features/Onboarding';
import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';

const MobileGlobalHeader = memo(() => {
  const avatar = useUserStore((s) => s.user?.avatar);
  const name = useUserStore((s) => s.user?.fullName ?? s.user?.email ?? '');
  const toggleLeftPanel = useGlobalStore((s) => s.toggleLeftPanel);

  return (
    <Flexbox
      align="center"
      gap={12}
      horizontal
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
        onClick={() => toggleLeftPanel(true)}
        size="large"
      />
      <Link
        href="/"
        style={{ alignItems: 'center', display: 'flex', flex: 1, gap: 6, textDecoration: 'none' }}
      >
        <span aria-hidden style={{ fontSize: 20 }}>
          🤯
        </span>
        <Text strong style={{ fontSize: 16 }}>
          WebGPT
        </Text>
      </Link>

      <BalanceBadge />

      <Avatar avatar={avatar ?? undefined} size={32} title={name} />
    </Flexbox>
  );
});

MobileGlobalHeader.displayName = 'MobileGlobalHeader';

export default MobileGlobalHeader;
