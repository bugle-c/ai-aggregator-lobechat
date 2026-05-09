'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';

import { useUserStore } from '@/store/user';

const MobileGreeting = memo(() => {
  const fullName = useUserStore((s) => s.user?.fullName);
  const email = useUserStore((s) => s.user?.email);
  const display = fullName || (email ? email.split('@')[0] : null);

  return (
    <Flexbox gap={4} paddingBlock={16} paddingInline={16}>
      <Text style={{ fontSize: 24, fontWeight: 700 }}>
        {display ? `Привет, ${display}! 👋` : 'Привет! 👋'}
      </Text>
      <Text style={{ color: 'var(--ant-color-text-secondary)', fontSize: 16 }}>
        Чем тебе помочь?
      </Text>
    </Flexbox>
  );
});

MobileGreeting.displayName = 'MobileGreeting';

export default MobileGreeting;
