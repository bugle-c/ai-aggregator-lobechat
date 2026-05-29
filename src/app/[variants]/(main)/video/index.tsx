'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import FlowSidebar from '@/features/Generators/FlowSidebar';
import { useGenerationCostPreview } from '@/features/Generators/useGenerationCostPreview';
import { useVideoGenerate } from '@/features/Generators/useVideoGenerate';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useVideoStore } from '@/store/video';
import { videoGenerationConfigSelectors } from '@/store/video/slices/generationConfig/selectors';
import { presetSelectors } from '@/store/video/slices/preset/selectors';

import FlowMainArea from './features/FlowMainArea';
import FlowSidebarControls from './features/FlowSidebarControls';
import PlanGateBanner from './features/PlanGateBanner';
import PromptInput from './features/PromptInput';
import VideoWorkspaceMobile from './VideoWorkspaceMobile';

const VideoPage = memo(() => {
  const isMobile = useIsMobile();

  const preset = useVideoStore(presetSelectors.currentPreset);
  const clearPreset = useVideoStore((s) => s.clearPreset);
  const isGenerating = useVideoStore((s) => s.isCreating);
  const currentModel = useVideoStore(videoGenerationConfigSelectors.model);
  const videoParameters = useVideoStore(videoGenerationConfigSelectors.parameters);
  const promptValue = (videoParameters?.prompt as string | undefined) ?? '';
  const generate = useVideoGenerate();
  // Pull current duration out of the param store. 5s is the most common
  // default across kling/seedance/veo/wan so we land on a sensible
  // estimate before the slider is touched.
  const durationSeconds = Number(videoParameters?.duration ?? 5) || 5;
  const cost = useGenerationCostPreview({
    durationSeconds,
    kind: 'video',
    model: currentModel,
  });

  if (isMobile) return <VideoWorkspaceMobile />;

  return (
    <Flexbox horizontal flex={1} height={'100%'} width={'100%'}>
      <FlowSidebar
        controls={<FlowSidebarControls />}
        creditCost={cost.credits ?? undefined}
        creditSufficient={cost.sufficient}
        isGenerating={isGenerating}
        modality="video"
        preset={preset}
        promptInput={<PromptInput />}
        onClearPreset={clearPreset}
        onGenerate={() => generate(promptValue)}
      />
      <Flexbox flex={1} height={'100%'}>
        <PlanGateBanner />
        <FlowMainArea />
      </Flexbox>
    </Flexbox>
  );
});

VideoPage.displayName = 'VideoPage';

export default VideoPage;
