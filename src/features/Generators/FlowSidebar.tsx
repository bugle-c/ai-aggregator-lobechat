'use client';

import { Button } from 'antd';
import { createStyles } from 'antd-style';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { Preset } from '@/types/preset';

import PresetThumbCard from './PresetThumbCard';

const useStyles = createStyles(({ css, token }) => ({
  /**
   * A scrolling flex column. Every slot is `flex-shrink: 0`: without it a
   * column taller than the viewport (style card + prompt + open «Ещё
   * настройки») made the browser *shrink* the flexible children — the style
   * card's media box collapsed to 0 px and the screen looked like a different
   * page — instead of scrolling.
   */
  root: css`
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;

    inline-size: 320px;
    min-inline-size: 320px;
    block-size: 100%;
    padding: 16px;
    border-inline-end: 1px solid ${token.colorBorderSecondary};

    background: ${token.colorBgLayout};

    & > * {
      flex-shrink: 0;
    }
  `,
  /** Always reachable: sticks to the bottom of the scroller when the column is tall. */
  cta: css`
    position: sticky;
    inset-block-end: -16px;

    margin-block-start: auto;
    margin-inline: -16px;
    padding: 12px 16px 16px;

    background: ${token.colorBgLayout};
  `,
}));

interface Props {
  /**
   * Live credit-cost estimate from useGenerationCostPreview. When provided,
   * the CTA label becomes «Сгенерировать · ≈ N кр» and the button turns red
   * if balance is insufficient. Undefined → plain label (e.g. on first paint
   * before the quote query resolves).
   */
  creditCost?: number;
  /** Set to false to hint the user lacks balance — recolours the CTA red. */
  creditSufficient?: boolean;
  /**
   * Blocks the CTA and replaces its label with the reason («Добавьте фото»
   * for an i2v style without a photo). Undefined → the CTA is live.
   */
  disabledReason?: string;
  isGenerating: boolean;
  onClearPreset: () => void;
  onGenerate: () => void;
  preset: Preset | null;
  /** PromptInput component instance — modality-specific so we keep this pluggable. */
  promptInput: ReactNode;
  /**
   * Composed-prompt preview for the selected preset. Sits directly under
   * the style card it describes. Modality-specific, like `promptInput`.
   */
  promptPreview?: ReactNode;
  /** The modality's `SettingsStrip` binding — model / aspect / duration / count / cost / ⚙. */
  settings: ReactNode;
}

/**
 * Desktop persistent sidebar (~320px). Top to bottom:
 *   1. PresetThumbCard (selected style, or the empty placeholder)
 *   2. PresetPromptPreview (what the style will actually send)
 *   3. SettingsStrip (the knobs, right above the words they apply to)
 *   4. PromptInput
 *   5. «Сгенерировать · ≈ N кр» — sticky at the bottom of the scroller
 */
const FlowSidebar = memo<Props>(
  ({
    creditCost,
    creditSufficient = true,
    disabledReason,
    isGenerating,
    onClearPreset,
    onGenerate,
    preset,
    promptInput,
    promptPreview,
    settings,
  }) => {
    const { t } = useTranslation('common');
    const { styles } = useStyles();
    const insufficient = creditCost !== undefined && !creditSufficient;
    const label = t('preset.generate');

    return (
      <div className={styles.root}>
        <PresetThumbCard preset={preset} onClear={onClearPreset} />
        {promptPreview}
        {settings}
        {promptInput}
        <div className={styles.cta}>
          <Button
            block
            danger={insufficient}
            disabled={!!disabledReason}
            loading={isGenerating}
            size="large"
            type="primary"
            onClick={onGenerate}
          >
            {disabledReason ??
              (creditCost === undefined
                ? label
                : `${label} · ${t('preset.credits', { count: creditCost })}`)}
          </Button>
        </div>
      </div>
    );
  },
);

FlowSidebar.displayName = 'FlowSidebar';

export default FlowSidebar;
