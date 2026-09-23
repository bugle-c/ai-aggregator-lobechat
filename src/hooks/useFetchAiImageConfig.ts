import { useEffect, useMemo } from 'react';

import { NEWCOMER_IMAGE_MODEL } from '@/const/settings';
import { lambdaQuery } from '@/libs/trpc/client';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useImageStore } from '@/store/image';
import {
  DEFAULT_AI_IMAGE_MODEL,
  DEFAULT_AI_IMAGE_PROVIDER,
} from '@/store/image/slices/generationConfig/initialState';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const checkModelEnabled = (
  enabledImageModelList: ReturnType<typeof aiProviderSelectors.enabledImageModelList>,
  provider: string,
  model: string,
) => {
  return enabledImageModelList.some(
    (p) => p.id === provider && p.children.some((m) => m.id === model),
  );
};

export const useFetchAiImageConfig = () => {
  const isStatusInit = useGlobalStore(systemStatusSelectors.isStatusInit);
  const isInitAiProviderRuntimeState = useAiInfraStore(
    aiProviderSelectors.isInitAiProviderRuntimeState,
  );

  const isAuthLoaded = useUserStore(authSelectors.isLoaded);
  const isLogin = useUserStore(authSelectors.isLogin);
  const isActualLogout = isAuthLoaded && isLogin === false;

  const isUserStateInit = useUserStore((s) => s.isUserStateInit);
  const isUserStateReady = isUserStateInit || isActualLogout;

  const isReadyForInit = isStatusInit && isInitAiProviderRuntimeState && isUserStateReady;

  const { lastSelectedImageModel, lastSelectedImageProvider } = useGlobalStore((s) => ({
    lastSelectedImageModel: s.status.lastSelectedImageModel,
    lastSelectedImageProvider: s.status.lastSelectedImageProvider,
  }));
  const isInitializedImageConfig = useImageStore((s) => s.isInit);
  const initializeImageConfig = useImageStore((s) => s.initializeImageConfig);

  const enabledImageModelList = useAiInfraStore(aiProviderSelectors.enabledImageModelList);

  // Newcomer mode (2026-09-22): a free user in their first week with < 3
  // pictures starts on Nano Banana instead of flux-schnell (owner's rule).
  // Only consulted when the user never picked a model themselves, so the
  // default returns to flux-schnell by itself once the threshold is reached.
  const needsNewcomerCheck = Boolean(isLogin) && !lastSelectedImageModel;
  const { data: creditState, isFetched: creditStateFetched } =
    lambdaQuery.spend.getCreditState.useQuery(undefined, {
      enabled: needsNewcomerCheck,
      retry: false,
      staleTime: 60_000,
    });
  const newcomerDefault =
    creditState?.newcomer?.nanoBananaDefault === true ? NEWCOMER_IMAGE_MODEL : undefined;

  // Determine which model/provider to use for initialization
  const initParams = useMemo(() => {
    // 1. Try lastSelected if enabled
    if (
      lastSelectedImageModel &&
      lastSelectedImageProvider &&
      checkModelEnabled(enabledImageModelList, lastSelectedImageProvider, lastSelectedImageModel)
    ) {
      return { model: lastSelectedImageModel, provider: lastSelectedImageProvider };
    }

    // 1b. Newcomer default (Nano Banana) from whichever provider exposes it.
    if (newcomerDefault) {
      const providerWithNewcomerModel = enabledImageModelList.find((p) =>
        p.children.some((m) => m.id === newcomerDefault),
      );
      if (providerWithNewcomerModel) {
        return { model: newcomerDefault, provider: providerWithNewcomerModel.id };
      }
    }

    // 2. Try default model from any enabled provider (prefer default provider first)
    if (
      checkModelEnabled(enabledImageModelList, DEFAULT_AI_IMAGE_PROVIDER, DEFAULT_AI_IMAGE_MODEL)
    ) {
      return { model: undefined, provider: undefined }; // Use initialState defaults
    }
    const providerWithDefaultModel = enabledImageModelList.find((p) =>
      p.children.some((m) => m.id === DEFAULT_AI_IMAGE_MODEL),
    );
    if (providerWithDefaultModel) {
      return { model: DEFAULT_AI_IMAGE_MODEL, provider: providerWithDefaultModel.id };
    }

    // 3. Fallback to first enabled model
    const firstProvider = enabledImageModelList[0];
    const firstModel = firstProvider?.children[0];
    if (firstProvider && firstModel) {
      return { model: firstModel.id, provider: firstProvider.id };
    }

    // No enabled models
    return { model: undefined, provider: undefined };
  }, [lastSelectedImageModel, lastSelectedImageProvider, enabledImageModelList, newcomerDefault]);

  // Wait for the newcomer answer (or its failure) before initialising, so the
  // picker does not flash flux-schnell and then jump to Nano Banana.
  const newcomerResolved = !needsNewcomerCheck || creditStateFetched;

  useEffect(() => {
    if (!isInitializedImageConfig && isReadyForInit && newcomerResolved) {
      // A newcomer default must be passed like a remembered model so the
      // store loads that model's parameter schema; it is NOT written to
      // lastSelected (only an explicit pick in the picker does that).
      initializeImageConfig(isLogin, initParams.model, initParams.provider);
    }
  }, [
    isReadyForInit,
    isInitializedImageConfig,
    isLogin,
    initParams,
    initializeImageConfig,
    newcomerResolved,
    newcomerDefault,
  ]);
};
