'use client';

import { ActionIcon, Tooltip } from '@lobehub/ui';
import { Button, Drawer, Popover } from 'antd';
import { createStyles } from 'antd-style';
import { ChevronDown, Lock, Settings2 } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useIsMobile } from '@/hooks/useIsMobile';

/** Model names longer than this are ellipsised in the chip; the full name goes in `title`. */
const CHIP_LABEL_MAX = 14;

const truncateChipLabel = (label: string): string =>
  label.length > CHIP_LABEL_MAX ? `${label.slice(0, CHIP_LABEL_MAX - 1)}…` : label;

const useStyles = createStyles(({ css, token }) => ({
  root: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-inline-size: 0;
  `,
  row: css`
    display: flex;
    gap: 8px;
    align-items: center;
    min-inline-size: 0;
  `,
  /** The inline «Дополнительные настройки» panel under the chip row. */
  advanced: css`
    display: flex;
    flex-direction: column;
    gap: 14px;

    padding: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 12px;

    background: ${token.colorFillQuaternary};
  `,
  advancedLabel: css`
    font-size: 12px;
    font-weight: 500;
    color: ${token.colorTextSecondary};
  `,
  gearOpen: css`
    color: ${token.colorPrimary} !important;
    background: ${token.colorPrimaryBg} !important;
  `,
  /**
   * Left group scrolls (hidden scrollbar, right-edge fade) so on a 360px
   * phone the video strip's third chip slides under the fixed right group
   * instead of wrapping onto a second row.
   */
  scroller: css`
    scrollbar-width: none;

    overflow-x: auto;
    display: flex;
    flex: 1 1 auto;
    gap: 8px;
    align-items: center;

    min-inline-size: 0;

    mask-image: linear-gradient(90deg, #000 calc(100% - 16px), transparent 100%);

    -webkit-overflow-scrolling: touch;

    &::-webkit-scrollbar {
      display: none;
    }
  `,
  fixed: css`
    display: flex;
    flex: 0 0 auto;
    gap: 4px;
    align-items: center;
  `,
  chip: css`
    flex: 0 0 auto;
    gap: 6px;
    max-inline-size: 220px;
    white-space: nowrap;
  `,
  chipOpen: css`
    background: ${token.colorPrimaryBg} !important;
  `,
  chipLabel: css`
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  /** 6px warning dot: "the style was tuned for a different model". */
  warnDot: css`
    flex: 0 0 auto;

    inline-size: 6px;
    block-size: 6px;
    border-radius: 50%;

    background: ${token.colorWarning};
  `,
  cost: css`
    flex: 0 0 auto;

    padding-inline: 4px;

    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${token.colorTextSecondary};
    white-space: nowrap;
  `,
  costInsufficient: css`
    cursor: pointer;
    color: ${token.colorError};
    text-decoration: underline dotted;
  `,
  drawerBody: css`
    padding: 16px;
  `,
}));

interface ChipProps {
  /** Screen-reader name; also the drawer title on mobile. */
  ariaLabel: string;
  /** Popover (desktop) / bottom drawer (mobile) content. `close` dismisses it. */
  content: (close: () => void) => ReactNode;
  icon?: ReactNode;
  /** Small state marker before the label. */
  indicator?: 'warning' | 'locked';
  label: string;
  /** Explains the indicator; shown on hover / long-press. */
  tooltip?: string;
}

/**
 * One setting as a round `Button` — the same chip the category strip uses,
 * 32px on desktop and 40px on a phone. Opens a `Popover` beside the chip
 * on desktop and a bottom `Drawer` on mobile.
 */
export const SettingsChip = memo<ChipProps>(
  ({ ariaLabel, content, icon, indicator, label, tooltip }) => {
    const { styles, cx } = useStyles();
    const isMobile = useIsMobile();
    const [open, setOpen] = useState(false);
    const close = () => setOpen(false);

    const button = (
      <Button
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cx(styles.chip, open && styles.chipOpen)}
        shape="round"
        size={isMobile ? 'middle' : 'small'}
        title={label}
        variant="filled"
        onClick={isMobile ? () => setOpen(true) : undefined}
      >
        {indicator === 'warning' && <span aria-hidden className={styles.warnDot} />}
        {indicator === 'locked' && <Lock size={12} />}
        {icon}
        <span className={styles.chipLabel}>{truncateChipLabel(label)}</span>
        <ChevronDown size={12} />
      </Button>
    );

    const withTooltip = tooltip ? <Tooltip title={tooltip}>{button}</Tooltip> : button;

    if (isMobile) {
      return (
        <>
          {withTooltip}
          <Drawer
            classNames={{ body: styles.drawerBody }}
            height="auto"
            open={open}
            placement="bottom"
            title={ariaLabel}
            onClose={close}
          >
            {open && content(close)}
          </Drawer>
        </>
      );
    }

    return (
      <Popover
        content={content(close)}
        open={open}
        placement="bottomLeft"
        trigger="click"
        onOpenChange={setOpen}
      >
        {withTooltip}
      </Popover>
    );
  },
);

SettingsChip.displayName = 'SettingsChip';

/** One labelled row inside the advanced panel. */
export const AdvancedItem = memo<{ children: ReactNode; label: string }>(({ children, label }) => {
  const { styles } = useStyles();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className={styles.advancedLabel}>{label}</span>
      {children}
    </div>
  );
});

AdvancedItem.displayName = 'SettingsAdvancedItem';

interface StripProps {
  /**
   * The model's remaining knobs (seed, resolution, steps, references…) that
   * have no chip of their own. Rendered inline under the chip row, toggled by
   * ⚙ — no drawer, so it can never cover the prompt or the CTA. Omit it when
   * the model has nothing extra and the gear disappears.
   */
  advanced?: ReactNode;
  children: ReactNode;
  cost: { credits: number | null; sufficient: boolean };
}

/**
 * The settings row above the prompt input:
 * `[Model ▾][3:4 ▾][5 s ▾] … [≈ 12 cr][⚙]`, plus the collapsible
 * «Дополнительные настройки» panel right under it.
 *
 * Presentational — the modality bindings (`FlowSidebarControls`) decide
 * which chips exist and wire them to the stores. Two groups: the chips
 * scroll, the cost and the gear stay put.
 */
const SettingsStrip = memo<StripProps>(({ advanced, children, cost }) => {
  const { styles, cx } = useStyles();
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const insufficient = cost.credits !== null && !cost.sufficient;
  const showAdvanced = !!advanced && advancedOpen;

  return (
    <div className={styles.root}>
      <div className={styles.row}>
        <div className={styles.scroller}>{children}</div>
        <div className={styles.fixed}>
          {cost.credits !== null &&
            (insufficient ? (
              <Tooltip title={t('preset.insufficientCredits')}>
                <button
                  className={cx(styles.cost, styles.costInsufficient)}
                  style={{ background: 'transparent', border: 0 }}
                  type="button"
                  onClick={() => navigate('/settings/plans')}
                >
                  {t('preset.credits', { count: cost.credits })}
                </button>
              </Tooltip>
            ) : (
              <span className={styles.cost}>{t('preset.credits', { count: cost.credits })}</span>
            ))}
          {advanced && (
            <ActionIcon
              aria-expanded={advancedOpen}
              aria-label={t('preset.settings.more')}
              className={cx(advancedOpen && styles.gearOpen)}
              icon={Settings2}
              size="small"
              title={t('preset.settings.more')}
              onClick={() => setAdvancedOpen((v) => !v)}
            />
          )}
        </div>
      </div>
      {showAdvanced && <div className={styles.advanced}>{advanced}</div>}
    </div>
  );
});

SettingsStrip.displayName = 'SettingsStrip';

export default SettingsStrip;
