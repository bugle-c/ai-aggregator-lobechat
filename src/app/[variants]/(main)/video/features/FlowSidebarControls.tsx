'use client';

import { Segmented, SliderWithInput } from '@lobehub/ui';
import { Drawer } from 'antd';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AspectRatioSelect from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/AspectRatioSelect';
import ConfigPanel from '@/app/[variants]/(main)/video/_layout/ConfigPanel';
import VideoModelItem from '@/app/[variants]/(main)/video/_layout/ConfigPanel/components/ModelSelect/VideoModelItem';
import ModelSettingsChip from '@/features/Generators/ModelSettingsChip';
import SettingsStrip, { SettingsChip } from '@/features/Generators/SettingsStrip';
import { useGenerationCostPreview } from '@/features/Generators/useGenerationCostPreview';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/slices/aiProvider/selectors';
import { useUserStore } from '@/store/user';
import { uiModeSelectors } from '@/store/user/slices/uiMode/selectors';
import { useVideoStore } from '@/store/video';
import { videoGenerationConfigSelectors } from '@/store/video/selectors';
import { useVideoGenerationConfigParam } from '@/store/video/slices/generationConfig/hooks';
import { presetSelectors } from '@/store/video/slices/preset/selectors';

/** A duration range with more steps than this gets a slider instead of buttons. */
const MAX_SEGMENTED_STEPS = 6;

const DEFAULT_DURATION = 5;

/** Duration chip body: the model's `min…max` by `step` as buttons when few, else a slider. */
const DurationPicker = memo<{ close: () => void }>(({ close }) => {
  const { t } = useTranslation('common');
  const { value, setValue, min, max, step, enumValues } = useVideoGenerationConfigParam('duration');

  const options = useMemo(() => {
    if (enumValues && enumValues.length > 0) return enumValues.map(Number);
    if (typeof min !== 'number' || typeof max !== 'number') return null;
    const s = step && step > 0 ? step : 1;
    if ((max - min) / s + 1 > MAX_SEGMENTED_STEPS) return null;
    const out: number[] = [];
    for (let v = min; v <= max; v += s) out.push(v);
    return out;
  }, [enumValues, max, min, step]);

  if (options) {
    return (
      <Segmented
        block
        style={{ minInlineSize: 200 }}
        value={value ?? min}
        variant="filled"
        options={options.map((v) => ({
          label: t('preset.settings.durationUnit', { count: v }),
          value: v,
        }))}
        onChange={(v) => {
          setValue(Number(v) as any);
          close();
        }}
      />
    );
  }

  return (
    <div style={{ minInlineSize: 240 }}>
      <SliderWithInput
        max={max}
        min={min}
        step={step ?? 1}
        value={value ?? min}
        onChange={(v) => setValue(v as any)}
      />
    </div>
  );
});

DurationPicker.displayName = 'VideoDurationPicker';

/**
 * Video binding of the `SettingsStrip`:
 * `[Model ▾][16:9 ▾][5 s ▾] … [≈ 40 cr][⚙]`, plus the drawer with the full
 * `ConfigPanel` (frames, resolution, seed, audio…) the gear opens.
 */
const FlowSidebarControls = memo(() => {
  const { t } = useTranslation('common');
  const isMobile = useIsMobile();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const preset = useVideoStore(presetSelectors.currentPreset);
  const [model, provider] = useVideoStore((s) => [
    videoGenerationConfigSelectors.model(s),
    videoGenerationConfigSelectors.provider(s),
  ]);
  const setModelAndProviderOnSelect = useVideoStore((s) => s.setModelAndProviderOnSelect);
  const supportsAspectRatio = useVideoStore(
    videoGenerationConfigSelectors.isSupportedParam('aspectRatio'),
  );
  const supportsDuration = useVideoStore(
    videoGenerationConfigSelectors.isSupportedParam('duration'),
  );
  const aspect = useVideoGenerationConfigParam('aspectRatio');
  const duration = useVideoGenerationConfigParam('duration');

  const uiMode = useUserStore(uiModeSelectors.current);
  const providers = useAiInfraStore(aiProviderSelectors.enabledVideoModelListByMode(uiMode));

  const durationSeconds = Number(duration.value ?? DEFAULT_DURATION) || DEFAULT_DURATION;
  const cost = useGenerationCostPreview({ durationSeconds, kind: 'video', model });

  const aspectItems = useMemo(
    () => (aspect.enumValues ?? []).map((v) => ({ value: v })),
    [aspect.enumValues],
  );

  return (
    <>
      <SettingsStrip cost={cost} onOpenAdvanced={() => setAdvancedOpen(true)}>
        <ModelSettingsChip
          currentModel={model}
          currentProvider={provider}
          providers={providers}
          recommendedModelId={preset?.recommendedModelId}
          renderModel={(m, providerId) => (
            <VideoModelItem {...m} providerId={providerId} showPopover={false} />
          )}
          onPick={setModelAndProviderOnSelect}
        />
        {supportsAspectRatio && aspectItems.length > 0 && (
          <SettingsChip
            ariaLabel={t('preset.settings.aspect')}
            label={aspect.value ?? aspectItems[0].value}
            content={(close) => (
              <AspectRatioSelect
                options={aspectItems}
                value={aspect.value}
                onChange={(v) => {
                  aspect.setValue(v as any);
                  close();
                }}
              />
            )}
          />
        )}
        {supportsDuration && (
          <SettingsChip
            ariaLabel={t('preset.settings.duration')}
            content={(close) => <DurationPicker close={close} />}
            label={t('preset.settings.durationUnit', { count: durationSeconds })}
          />
        )}
      </SettingsStrip>

      <Drawer
        destroyOnHidden={false}
        open={advancedOpen}
        placement="right"
        styles={{ body: { padding: 0 } }}
        title={t('preset.settings.more')}
        width={isMobile ? '90vw' : 360}
        onClose={() => setAdvancedOpen(false)}
      >
        <ConfigPanel />
      </Drawer>
    </>
  );
});

FlowSidebarControls.displayName = 'VideoFlowSidebarControls';

export default FlowSidebarControls;
