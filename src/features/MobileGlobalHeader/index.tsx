'use client';

import { Avatar, Flexbox, Text } from '@lobehub/ui';
import Link from 'next/link';
import { memo } from 'react';

import { BalanceBadge } from '@/features/Onboarding';
import { useUserStore } from '@/store/user';

const MobileGlobalHeader = memo(() => {
  const avatar = useUserStore((s) => s.user?.avatar);
  const name = useUserStore((s) => s.user?.fullName ?? s.user?.email ?? '');

  return (
    <Flexbox
      align="center"
      horizontal
      justify="space-between"
      paddingInline={16}
      style={{
        background: 'var(--ant-color-bg-container)',
        borderBlockEnd: '1px solid var(--ant-color-border-secondary)',
        height: 56,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <Link href="/" style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
        <span aria-hidden style={{ fontSize: 20 }}>🤯</span>
        <Text strong style={{ fontSize: 16 }}>WebGPT</Text>
      </Link>

      <BalanceBadge />

      <Avatar avatar={avatar ?? undefined} size={32} title={name} />
    </Flexbox>
  );
});

MobileGlobalHeader.displayName = 'MobileGlobalHeader';

export default MobileGlobalHeader;
