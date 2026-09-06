'use client';

import { memo, useCallback } from 'react';

import PresetPromptPreview from '@/features/Generators/PresetPromptPreview';
import { useVideoStore } from '@/store/video';
import { useVideoGenerationConfigParam } from '@/store/video/slices/generationConfig/hooks';
import { presetSelectors } from '@/store/video/slices/preset/selectors';

/** Binds the shared prompt preview to the video generation config. */
const VideoPresetPromptPreview = memo(() => {
  const preset = useVideoStore(presetSelectors.currentPreset);
  const clearPreset = useVideoStore((s) => s.clearPreset);
  const { value, setValue } = useVideoGenerationConfigParam('prompt');

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

VideoPresetPromptPreview.displayName = 'VideoPresetPromptPreview';

export default VideoPresetPromptPreview;
