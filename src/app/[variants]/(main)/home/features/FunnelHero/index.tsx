'use client';

import { Center } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';

/**
 * Compact "funnel hero" shown at the top of the home page.
 *
 * Text-only (no images/carousel): RU users are DPI-throttled on heavy
 * assets, so we keep this to an H1 + subtitle that loads instantly.
 * Sizes down on mobile so it stays compact above the quick actions.
 */
const FunnelHero = memo(() => {
  const { t } = useTranslation('home');
  const isMobile = useIsMobile();

  return (
    <Center
      style={{
        marginBlock: isMobile ? '12px 4px' : '36px 8px',
        paddingInline: 16,
        textAlign: 'center',
      }}
    >
      <h1
        style={{
          fontSize: isMobile ? 24 : 32,
          fontWeight: 700,
          lineHeight: 1.15,
          margin: 0,
        }}
      >
        {t('hero.title')}
      </h1>
      <p
        style={{
          color: 'var(--ant-color-text-secondary)',
          fontSize: isMobile ? 14 : 16,
          lineHeight: 1.4,
          marginBlock: isMobile ? 8 : 12,
          maxWidth: 560,
        }}
      >
        {t('hero.subtitle')}
      </p>
    </Center>
  );
});

FunnelHero.displayName = 'FunnelHero';

export default FunnelHero;
