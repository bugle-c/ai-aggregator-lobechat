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
    gap: 8px;
    align-items: center;
    min-inline-size: 0;
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

interface StripProps {
  children: ReactNode;
  cost: { credits: number | null; sufficient: boolean };
  /** Opens the full `ConfigPanel` drawer (seed, steps, cfg, references…). */
  onOpenAdvanced: () => void;
}

/**
 * The settings row above the prompt input:
 * `[Model ▾][3:4 ▾][5 s ▾] … [≈ 12 cr][⚙]`.
 *
 * Presentational — the modality bindings (`FlowSidebarControls`) decide
 * which chips exist and wire them to the stores. Two groups: the chips
 * scroll, the cost and the gear stay put.
 */
const SettingsStrip = memo<StripProps>(({ children, cost, onOpenAdvanced }) => {
  const { styles, cx } = useStyles();
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const insufficient = cost.credits !== null && !cost.sufficient;

  return (
    <div className={styles.root}>
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
        <ActionIcon
          aria-label={t('preset.settings.more')}
          icon={Settings2}
          size="small"
          title={t('preset.settings.more')}
          onClick={onOpenAdvanced}
        />
      </div>
    </div>
  );
});

SettingsStrip.displayName = 'SettingsStrip';

export default SettingsStrip;
