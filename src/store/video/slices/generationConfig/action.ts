import {
  type AIVideoModelCard,
  extractVideoDefaultValues,
  type RuntimeVideoGenParamsKeys,
  type RuntimeVideoGenParamsValue,
  type VideoModelParamsSchema,
} from 'model-bank';
import { type StateCreator } from 'zustand/vanilla';

import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { useGlobalStore } from '@/store/global';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import type { VideoStore } from '../../store';

export interface GenerationConfigAction {
  initializeVideoConfig: (
    isLogin?: boolean,
    lastSelectedVideoModel?: string,
    lastSelectedVideoProvider?: string,
  ) => void;

  setModelAndProviderOnSelect: (model: string, provider: string) => void;

  setParamOnInput: <K extends RuntimeVideoGenParamsKeys>(
    paramName: K,
    value: RuntimeVideoGenParamsValue,
  ) => void;
}

export function getVideoModelAndDefaults(model: string, provider: string) {
  const enabledVideoModelList = aiProviderSelectors.enabledVideoModelList(getAiInfraStoreState());

  const providerItem = enabledVideoModelList.find((providerItem) => providerItem.id === provider);
  if (!providerItem) {
    throw new Error(
      `Provider "${provider}" not found in enabled video provider list. Available providers: ${enabledVideoModelList.map((p) => p.id).join(', ')}`,
    );
  }

  const activeModel = providerItem.children.find(
    (modelItem) => modelItem.id === model,
  ) as unknown as AIVideoModelCard;
  if (!activeModel) {
    throw new Error(
      `Model "${model}" not found in provider "${provider}". Available models: ${providerItem.children.map((m) => m.id).join(', ')}`,
    );
  }

  const parametersSchema = activeModel.parameters as VideoModelParamsSchema;
  const defaultValues = extractVideoDefaultValues(parametersSchema);

  return { activeModel, defaultValues, parametersSchema };
}

export const createGenerationConfigSlice: StateCreator<
  VideoStore,
  [['zustand/devtools', never]],
  [],
  GenerationConfigAction
> = (set) => ({
  initializeVideoConfig: (isLogin, lastSelectedVideoModel, lastSelectedVideoProvider) => {
    if (isLogin && lastSelectedVideoModel && lastSelectedVideoProvider) {
      try {
        const { defaultValues, parametersSchema } = getVideoModelAndDefaults(
          lastSelectedVideoModel,
          lastSelectedVideoProvider,
        );

        set(
          {
            isInit: true,
            model: lastSelectedVideoModel,
            parameters: defaultValues,
            parametersSchema,
            provider: lastSelectedVideoProvider,
          },
          false,
          `initializeVideoConfig/${lastSelectedVideoModel}/${lastSelectedVideoProvider}`,
        );
      } catch {
        set({ isInit: true }, false, 'initializeVideoConfig/default');
      }
    } else {
      set({ isInit: true }, false, 'initializeVideoConfig/default');
    }
  },

  setModelAndProviderOnSelect: (model, provider) => {
    // Resolve schema + defaults if available. When the chosen model
    // has no registered `parameters` definition (e.g. an aggregator
    // exposes a model whose schema lives elsewhere), `extractVideo
    // DefaultValues` throws ZodError — degrade gracefully: keep
    // model+provider but skip schema/defaults so the UI doesn't crash.
    let defaultValues: ReturnType<typeof getVideoModelAndDefaults>['defaultValues'] | undefined;
    let parametersSchema:
      | ReturnType<typeof getVideoModelAndDefaults>['parametersSchema']
      | undefined;
    try {
      const resolved = getVideoModelAndDefaults(model, provider);
      defaultValues = resolved.defaultValues;
      parametersSchema = resolved.parametersSchema;
    } catch (err) {
       
      console.warn(
        '[setModelAndProviderOnSelect] schema resolve failed for',
        `${provider}/${model}`,
        '—',
        (err as Error)?.message,
      );
    }

    set(
      {
        model,
        ...(defaultValues ? { parameters: defaultValues } : {}),
        ...(parametersSchema ? { parametersSchema } : {}),
        provider,
      },
      false,
      `setModelAndProviderOnSelect/${model}/${provider}`,
    );

    const isLogin = authSelectors.isLogin(useUserStore.getState());
    if (isLogin) {
      useGlobalStore.getState().updateSystemStatus({
        lastSelectedVideoModel: model,
        lastSelectedVideoProvider: provider,
      });
    }
  },

  setParamOnInput: (paramName, value) => {
    set(
      (state) => {
        const { parameters } = state;
        return { parameters: { ...parameters, [paramName]: value } };
      },
      false,
      `setParamOnInput/${paramName}`,
    );
  },
});
