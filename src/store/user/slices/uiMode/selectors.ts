import { type UserStore } from '../../store';

const current = (s: UserStore) => s.uiMode;
const isLight = (s: UserStore) => s.uiMode === 'light';
const isPro = (s: UserStore) => s.uiMode === 'pro';
const loading = (s: UserStore) => s.uiModeLoading;

export const uiModeSelectors = {
  current,
  isLight,
  isPro,
  loading,
};
