'use client';

import { useEffect } from 'react';

import { useQueryState } from '@/hooks/useQueryParam';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useVideoStore } from '@/store/video';

/** The model «Оживить картинку» lands on — the pool-rendered Veo 3.1 Fast (image→video via pairing). */
export const ANIMATE_MODEL_ID = 'google/veo3.1-fast/text-to-video';

/**
 * `/video?animate=<imageUrl>` — opened from the «Оживить картинку» action on
 * an image card. Once the video config store is initialised, switch to Veo
 * 3.1 Fast, drop the image in as the start frame and preset a short 720p
 * clip (the free-plan trial only admits exactly this shape), then strip the
 * param so a reload does not re-apply it.
 */
export const useAnimateDeepLink = () => {
  const [animate, setAnimate] = useQueryState('animate');
  const isInit = useVideoStore((s) => s.isInit);
  const clearPreset = useVideoStore((s) => s.clearPreset);
  const setModelAndProviderOnSelect = useVideoStore((s) => s.setModelAndProviderOnSelect);
  const setParamOnInput = useVideoStore((s) => s.setParamOnInput);
  const enabledVideoModelList = useAiInfraStore(aiProviderSelectors.enabledVideoModelList);

  useEffect(() => {
    if (!animate || !isInit) return;
    const provider = enabledVideoModelList.find((p) =>
      p.children.some((m) => m.id === ANIMATE_MODEL_ID),
    );
    if (!provider) return; // model list not loaded yet — try again on the next render

    try {
      clearPreset();
      setModelAndProviderOnSelect(ANIMATE_MODEL_ID, provider.id);
      setParamOnInput('imageUrl', animate);
      setParamOnInput('duration', 4);
      setParamOnInput('resolution', '720p');
    } catch (error) {
      console.warn('[animate] could not prefill the video config:', error);
    }
    void setAnimate(null);
  }, [
    animate,
    isInit,
    enabledVideoModelList,
    clearPreset,
    setModelAndProviderOnSelect,
    setParamOnInput,
    setAnimate,
  ]);
};
