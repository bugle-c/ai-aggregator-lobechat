'use client';

import { memo, useCallback } from 'react';

import PresetPromptPreview from '@/features/Generators/PresetPromptPreview';
import { useImageStore } from '@/store/image';
import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';
import { presetSelectors } from '@/store/image/slices/preset/selectors';

/** Binds the shared prompt preview to the image generation config. */
const ImagePresetPromptPreview = memo(() => {
  const preset = useImageStore(presetSelectors.currentPreset);
  const clearPreset = useImageStore((s) => s.clearPreset);
  const { value, setValue } = useGenerationConfigParam('prompt');

  const handleEdit = useCallback(
    (composed: string) => {
      // Detach after copying, so the template is not applied a second time
      // on top of a prompt that already contains it.
      setValue(composed);
      clearPreset();
    },
    [clearPreset, setValue],
  );

  return (
    <PresetPromptPreview
      preset={preset}
      userPrompt={value ?? ''}
      onClear={clearPreset}
      onEdit={handleEdit}
    />
  );
});

ImagePresetPromptPreview.displayName = 'ImagePresetPromptPreview';

export default ImagePresetPromptPreview;
