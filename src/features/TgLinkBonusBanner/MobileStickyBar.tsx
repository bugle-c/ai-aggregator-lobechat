'use client';

import { createStyles } from 'antd-style';
import { X } from 'lucide-react';
import { memo } from 'react';

import { onTgLinkClick, tgLinkHref } from './startTgLink';
import { dismissBanner, useShouldShow } from './useShouldShow';

// Keep in sync with src/features/MobileTabBar height.
const MOBILE_TAB_BAR_HEIGHT = 56;

const useStyles = createStyles(({ css }) => ({
  bar: css`
    position: fixed;
    z-index: 999;
    inset-block-end: calc(${MOBILE_TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom, 0px));
    inset-inline: 0;

    display: flex;
    align-items: center;
    justify-content: space-between;

    height: 40px;
    padding-block: 0;
    padding-inline: 10px;

    font-size: 13px;
    color: #fff;

    background: linear-gradient(135deg, #229ed9 0%, #1d8ec5 100%);
    box-shadow: 0 -2px 12px rgb(0 0 0 / 12%);
  `,
  text: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;
    margin-inline-end: 8px;

    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  cta: css`
    cursor: pointer;

    flex: 0 0 auto;

    padding-block: 4px;
    padding-inline: 12px;
    border: none;
    border-radius: 5px;

    font-size: 13px;
    font-weight: 600;
    color: #fff;
    text-decoration: none;

    background: rgb(255 255 255 / 22%);
  `,
  dismiss: css`
    cursor: pointer;

    flex: 0 0 auto;

    margin-inline-start: 4px;
    padding: 4px;
    border: none;

    color: rgb(255 255 255 / 70%);

    background: transparent;
  `,
}));

const MobileStickyBar = memo(() => {
  const { styles } = useStyles();
  const show = useShouldShow();
  if (!show) return null;

  return (
    <div className={styles.bar}>
      <div className={styles.text}>🎁 Привяжи Telegram и получи 100 кредитов</div>
      <a className={styles.cta} href={tgLinkHref()} onClick={onTgLinkClick}>
        Привязать
      </a>
      <button aria-label="Скрыть" className={styles.dismiss} type="button" onClick={dismissBanner}>
        <X size={16} />
      </button>
    </div>
  );
});

MobileStickyBar.displayName = 'MobileStickyBar';
export default MobileStickyBar;
