'use client';

import { createStyles } from 'antd-style';
import { Camera } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const useStyles = createStyles(({ css, token }) => ({
  base: css`
    pointer-events: none;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 6px;
    border-radius: 6px;

    font-size: 11px;
    font-weight: 600;
    line-height: 16px;
    white-space: nowrap;
  `,
  /** Over media: white on a dark translucent pill, like the play badge. */
  overlay: css`
    color: #fff;
    background: rgb(0 0 0 / 55%);
    backdrop-filter: blur(4px);
  `,
  /** In text flow (selected-style card, details modal): warning tint. */
  inline: css`
    color: ${token.colorWarningText};
    background: ${token.colorWarningBg};
  `,
}));

interface Props {
  /** «Фото» instead of «Нужно фото» — for a 140px mobile tile. */
  short?: boolean;
  variant: 'overlay' | 'inline';
}

/**
 * «Нужно фото» — marks an image-to-video preset wherever it is shown. Never
 * interactive (pointer-events: none), so it cannot become a second tap
 * target on a card.
 */
const RequiresImageBadge = memo<Props>(({ short, variant }) => {
  const { styles, cx } = useStyles();
  const { t } = useTranslation('common');
  const label = t(short ? 'preset.requiresImageShort' : 'preset.requiresImage');

  return (
    <span className={cx(styles.base, styles[variant])} title={t('preset.requiresImage')}>
      <Camera size={11} strokeWidth={2.5} />
      {label}
    </span>
  );
});

RequiresImageBadge.displayName = 'RequiresImageBadge';

export default RequiresImageBadge;
