'use client';

import { useUserStore } from '@/store/user';
import { uiModeSelectors } from '@/store/user/slices/uiMode/selectors';

export const useIsLightMode = () => useUserStore(uiModeSelectors.isLight);
