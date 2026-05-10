'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Image as ImageIcon, Video } from 'lucide-react';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

interface ChipDef {
  href: string;
  icon: React.ComponentType<{ size?: number }>;
  key: string;
  label: string;
}

// Only routes that actually exist in `desktopRouter.config.tsx` go here.
// Earlier `/translate` and `/tts` chips dumped users back to `/` via the
// catch-all. If we add those product surfaces later, list them again.
const CHIPS: ChipDef[] = [
  { href: '/image', icon: ImageIcon, key: 'image', label: 'Картинка' },
  { href: '/video', icon: Video, key: 'video', label: 'Видео' },
];

const MobileFeatureChipsRow = memo(() => {
  // Use react-router-dom navigate — `next/navigation`'s `useRouter().push`
  // does not drive the SPA router under the (main) tree, so chips
  // appeared dead.
  const navigate = useNavigate();

  return (
    <Flexbox
      horizontal
      gap={8}
      paddingInline={16}
      style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
    >
      {CHIPS.map(({ href, icon: Icon, key, label }) => (
        <Block
          clickable
          gap={6}
          key={key}
          padding={10}
          variant="filled"
          style={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'row',
            flexShrink: 0,
            minWidth: 110,
          }}
          onClick={() => navigate(href)}
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
