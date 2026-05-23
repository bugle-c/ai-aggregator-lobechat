'use client';

import { createStyles } from 'antd-style';
import { X } from 'lucide-react';
import { memo } from 'react';

import { onTgLinkClick, tgLinkHref } from './startTgLink';
import { dismissBanner, useShouldShow } from './useShouldShow';

const useStyles = createStyles(({ css }) => ({
  card: css`
    position: relative;

    margin-block: 8px;
    margin-inline: 12px;
    padding-block: 12px 14px;
    padding-inline: 14px;
    border-radius: 10px;

    font-size: 13px;
    line-height: 1.4;
    color: #fff;

    background: linear-gradient(135deg, #229ed9 0%, #1d8ec5 100%);
  `,
  title: css`
    margin-block-end: 4px;
    font-weight: 600;
  `,
  cta: css`
    cursor: pointer;

    display: inline-block;

    margin-block-start: 10px;
    padding-block: 6px;
    padding-inline: 14px;
    border: none;
    border-radius: 6px;

    font-size: 13px;
    font-weight: 600;
    color: #fff;
    text-decoration: none;

    background: rgb(255 255 255 / 18%);

    &:hover {
      background: rgb(255 255 255 / 28%);
    }
  `,
  dismiss: css`
    cursor: pointer;

    position: absolute;
    inset-block-start: 6px;
    inset-inline-end: 6px;

    padding: 2px;
    border: none;

    line-height: 1;
    color: rgb(255 255 255 / 70%);

    background: transparent;

    &:hover {
      color: #fff;
    }
  `,
}));

const PcSidebarCard = memo(() => {
  const { styles } = useStyles();
  const show = useShouldShow();
  if (!show) return null;

  return (
    <div className={styles.card}>
      <button aria-label="Скрыть" className={styles.dismiss} type="button" onClick={dismissBanner}>
        <X size={14} />
      </button>
      <div className={styles.title}>🎁 +100 кредитов</div>
      <div>Привяжи Telegram и получи 100 кредитов на 30 дней.</div>
      <a className={styles.cta} href={tgLinkHref()} onClick={onTgLinkClick}>
        Привязать
      </a>
    </div>
  );
});

PcSidebarCard.displayName = 'PcSidebarCard';
export default PcSidebarCard;
