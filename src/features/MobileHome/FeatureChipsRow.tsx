'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Image as ImageIcon, Languages, Mic, Video } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { memo } from 'react';

interface ChipDef {
  href: string;
  icon: React.ComponentType<{ size?: number }>;
  key: string;
  label: string;
}

const CHIPS: ChipDef[] = [
  { href: '/image', icon: ImageIcon, key: 'image', label: 'Картинка' },
  { href: '/video', icon: Video, key: 'video', label: 'Видео' },
  { href: '/translate', icon: Languages, key: 'translate', label: 'Перевод' },
  { href: '/tts', icon: Mic, key: 'tts', label: 'Озвучка' },
];

const MobileFeatureChipsRow = memo(() => {
  const router = useRouter();

  return (
    <Flexbox
      gap={8}
      horizontal
      paddingInline={16}
      style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
    >
      {CHIPS.map(({ href, icon: Icon, key, label }) => (
        <Block
          clickable
          gap={6}
          key={key}
          onClick={() => router.push(href)}
          padding={10}
          style={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'row',
            flexShrink: 0,
            minWidth: 110,
          }}
          variant="filled"
        >
          <Icon size={18} />
          <span style={{ fontSize: 14 }}>{label}</span>
        </Block>
      ))}
    </Flexbox>
  );
});

MobileFeatureChipsRow.displayName = 'MobileFeatureChipsRow';

export default MobileFeatureChipsRow;
