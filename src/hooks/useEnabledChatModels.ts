import isEqual from 'fast-deep-equal';

import { useAiInfraStore } from '@/store/aiInfra';
import { aiProviderSelectors } from '@/store/aiInfra/slices/aiProvider/selectors';
import { useUserStore } from '@/store/user';
import { uiModeSelectors } from '@/store/user/slices/uiMode/selectors';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

export const useEnabledChatModels = (): EnabledProviderWithModels[] => {
  const uiMode = useUserStore(uiModeSelectors.current);
  const enabledChatModelList = useAiInfraStore(
    aiProviderSelectors.enabledChatModelListByMode(uiMode),
    isEqual,
  );

  return enabledChatModelList;
};
