'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Button } from 'antd';
import { Sparkles } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Preset } from '@/types/preset';

import { tileAspectNumber } from './presetAspect';
import PresetAttribution from './PresetAttribution';
import PresetMP4Player from './PresetMP4Player';
import PresetZoomModal from './PresetZoomModal';
import RequiresImageBadge from './RequiresImageBadge';

interface Props {
  onClear: () => void;
  preset: Preset | null;
}

/**
 * The selected-style card never grows taller than 4:3 (width / height ≥
 * 1.333) — it is a reminder, not a viewer; a 9:16 video preset would
 * otherwise push the prompt input below the fold on a phone.
 */
const MIN_THUMB_ASPECT = 4 / 3;

/**
 * The selected style, at the top of the creation surface (desktop sidebar
 * and the mobile `?view=create` screen).
 *
 * Two 40px actions: «Подробнее» opens the zoom modal — on a phone this is
 * the only way into a style's details, the gallery tile has no zoom button
 * — and «Убрать» drops the style. The old «Рекомендуется: <model>» line is
 * gone: the model now switches by itself and the settings strip's model
 * chip shows the relationship instead. Attribution stays here (and in the
 * modal): this is where the user actually generates, which is where the
 * credit has to be.
 */
const PresetThumbCard = memo<Props>(({ onClear, preset }) => {
  const { t } = useTranslation('common');
  const [zoomOpen, setZoomOpen] = useState(false);

  if (!preset) {
    return (
      <Block
        padding={16}
        variant="outlined"
        style={{
          alignItems: 'center',
          borderStyle: 'dashed',
          color: 'var(--ant-color-text-tertiary)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          textAlign: 'center',
        }}
      >
        <Sparkles size={20} />
        <span style={{ fontSize: 13 }}>Выберите стиль или начните с чистого листа</span>
      </Block>
    );
  }

  return (
    <Block padding={0} style={{ overflow: 'hidden', position: 'relative' }} variant="filled">
      <div
        style={{
          aspectRatio: `${Math.max(tileAspectNumber(preset), MIN_THUMB_ASPECT)} / 1`,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <PresetMP4Player
          fallbackLabel={preset.title}
          posterUrl={preset.posterUrl ?? undefined}
          previewUrl={preset.previewUrl}
        />
      </div>
      <Flexbox gap={6} padding={8}>
        <Flexbox horizontal align="center" gap={8} justify="space-between">
          <span
            style={{
              flex: 1,
              fontSize: 13,
              fontWeight: 600,
              minInlineSize: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {preset.title}
          </span>
          <Button size="middle" type="link" onClick={() => setZoomOpen(true)}>
            {t('preset.details')}
          </Button>
        </Flexbox>
        {preset.requiresImage && (
          <Flexbox horizontal align="center" gap={6} style={{ minInlineSize: 0 }}>
            <RequiresImageBadge variant="inline" />
            <span
              style={{
                color: 'var(--ant-color-text-tertiary)',
                fontSize: 12,
                minInlineSize: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {t('preset.requiresImageHint')}
            </span>
          </Flexbox>
        )}
        <Flexbox horizontal align="center" gap={8} justify="space-between">
          <PresetAttribution compact preset={preset} />
          <Button size="middle" type="text" onClick={onClear}>
            {t('preset.remove')}
          </Button>
        </Flexbox>
      </Flexbox>

      {zoomOpen && (
        <PresetZoomModal
          open
          preset={preset}
          // Already the selected style — applying again is a no-op.
          onApply={() => {}}
          onClose={() => setZoomOpen(false)}
        />
      )}
    </Block>
  );
});

PresetThumbCard.displayName = 'PresetThumbCard';

export default PresetThumbCard;
