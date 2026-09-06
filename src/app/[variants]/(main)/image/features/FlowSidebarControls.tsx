'use client';

import { Drawer } from 'antd';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ConfigPanel from '@/app/[variants]/(main)/image/_layout/ConfigPanel';
import AspectRatioSelect from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/AspectRatioSelect';
import ImageNum from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/ImageNum';
import ImageModelItem from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/ModelSelect/ImageModelItem';
import ModelSettingsChip from '@/features/Generators/ModelSettingsChip';
import SettingsStrip, { SettingsChip } from '@/features/Generators/SettingsStrip';
import { useGenerationCostPreview } from '@/features/Generators/useGenerationCostPreview';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAiInfraStore } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/slices/aiProvider/selectors';
import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/selectors';
import { useDimensionControl } from '@/store/image/slices/generationConfig/hooks';
import { presetSelectors } from '@/store/image/slices/preset/selectors';
import { useUserStore } from '@/store/user';
import { uiModeSelectors } from '@/store/user/slices/uiMode/selectors';

/**
 * Image binding of the `SettingsStrip`:
 * `[Model ▾][3:4 ▾][1 pcs ▾] … [≈ 12 cr][⚙]`, plus the drawer with the full
 * `ConfigPanel` the gear opens. Used above the prompt input by the desktop
 * `FlowSidebar` and the mobile `MobileFlowContent`.
 */
const FlowSidebarControls = memo(() => {
  const { t } = useTranslation('common');
  const isMobile = useIsMobile();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const preset = useImageStore(presetSelectors.currentPreset);
  const [model, provider] = useImageStore((s) => [
    imageGenerationConfigSelectors.model(s),
    imageGenerationConfigSelectors.provider(s),
  ]);
  const setModelAndProviderOnSelect = useImageStore((s) => s.setModelAndProviderOnSelect);
  const imageNum = useImageStore(imageGenerationConfigSelectors.imageNum);
  const supportsAspectRatio = useImageStore(
    imageGenerationConfigSelectors.isSupportedParam('aspectRatio'),
  );
  // Goes through the dimension controller rather than a raw param write so
  // width/height follow the ratio the same way they do in ConfigPanel.
  const { aspectRatio, options: aspectOptions, setAspectRatio } = useDimensionControl();

  const uiMode = useUserStore(uiModeSelectors.current);
  const providers = useAiInfraStore(aiProviderSelectors.enabledImageModelListByMode(uiMode));

  const cost = useGenerationCostPreview({ images: imageNum, kind: 'image', model });

  const aspectItems = useMemo(() => aspectOptions.map((v) => ({ value: v })), [aspectOptions]);

  return (
    <>
      <SettingsStrip cost={cost} onOpenAdvanced={() => setAdvancedOpen(true)}>
        <ModelSettingsChip
          currentModel={model}
          currentProvider={provider}
          providers={providers}
          recommendedModelId={preset?.recommendedModelId}
          renderModel={(m, providerId) => (
            <ImageModelItem {...m} providerId={providerId} showPopover={false} />
          )}
          onPick={setModelAndProviderOnSelect}
        />
        {supportsAspectRatio && (
          <SettingsChip
            ariaLabel={t('preset.settings.aspect')}
            label={aspectRatio}
            content={(close) => (
              <AspectRatioSelect
                options={aspectItems}
                value={aspectRatio}
                onChange={(v) => {
                  setAspectRatio(v);
                  close();
                }}
              />
            )}
          />
        )}
        <SettingsChip
          ariaLabel={t('preset.settings.count')}
          label={t('preset.settings.countUnit', { count: imageNum })}
          content={() => (
            <div style={{ minInlineSize: 240 }}>
              <ImageNum />
            </div>
          )}
        />
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

FlowSidebarControls.displayName = 'ImageFlowSidebarControls';

export default FlowSidebarControls;
