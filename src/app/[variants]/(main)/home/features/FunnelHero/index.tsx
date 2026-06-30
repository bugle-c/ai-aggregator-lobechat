'use client';

import { Center } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Compact "funnel hero" shown at the top of the home page.
 *
 * Text-only (no images/carousel): RU users are DPI-throttled on heavy
 * assets, so we keep this to an H1 + subtitle that loads instantly.
 */
const FunnelHero = memo(() => {
  const { t } = useTranslation('home');

  return (
    <Center
      style={{
        marginBlock: '36px 8px',
        paddingInline: 16,
        textAlign: 'center',
      }}
    >
      <h1
        style={{
          fontSize: 32,
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
          fontSize: 16,
          lineHeight: 1.4,
          marginBlock: 12,
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
