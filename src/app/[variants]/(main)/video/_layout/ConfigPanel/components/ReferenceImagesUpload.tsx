import { memo } from 'react';

import MultiImagesUpload from '@/app/[variants]/(main)/image/_layout/ConfigPanel/components/MultiImagesUpload';
import { useVideoGenerationConfigParam } from '@/store/video/slices/generationConfig/hooks';

/**
 * Reference images for Seedance 2.0 Mini / full (`reference_images`, ≤ 9):
 * style, characters, composition. Not a start frame — the model stays on its
 * text-to-video endpoint. Reuses the image flow's multi uploader; the value
 * lands in the video store's `parameters.imageUrls`.
 */
const ReferenceImagesUpload = memo(() => {
  const { value, setValue, maxCount, maxFileSize } = useVideoGenerationConfigParam('imageUrls');

  return (
    <MultiImagesUpload
      maxCount={maxCount}
      maxFileSize={maxFileSize}
      value={value ?? []}
      onChange={(data) => setValue((Array.isArray(data) ? data : data.urls) as any)}
    />
  );
});

ReferenceImagesUpload.displayName = 'ReferenceImagesUpload';

export default ReferenceImagesUpload;
