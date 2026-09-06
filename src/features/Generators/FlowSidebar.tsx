'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from 'antd';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { Preset } from '@/types/preset';

import PresetThumbCard from './PresetThumbCard';

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
 *   5. «Сгенерировать · ≈ N кр»
 */
const FlowSidebar = memo<Props>(
  ({
    creditCost,
    creditSufficient = true,
    isGenerating,
    onClearPreset,
    onGenerate,
    preset,
    promptInput,
    promptPreview,
    settings,
  }) => {
    const { t } = useTranslation('common');
    const insufficient = creditCost !== undefined && !creditSufficient;
    const label = t('preset.generate');

    return (
      <Flexbox
        gap={12}
        height={'100%'}
        padding={16}
        style={{
          background: 'var(--ant-color-bg-layout)',
          borderInlineEnd: '1px solid var(--ant-color-border-secondary)',
          inlineSize: 320,
          minInlineSize: 320,
          overflowY: 'auto',
        }}
      >
        <PresetThumbCard preset={preset} onClear={onClearPreset} />
        {promptPreview}
        {settings}
        {promptInput}
        <Button
          block
          danger={insufficient}
          loading={isGenerating}
          size="large"
          style={{ marginBlockStart: 'auto' }}
          type="primary"
          onClick={onGenerate}
        >
          {creditCost === undefined
            ? label
            : `${label} · ${t('preset.credits', { count: creditCost })}`}
        </Button>
      </Flexbox>
    );
  },
);

FlowSidebar.displayName = 'FlowSidebar';

export default FlowSidebar;
