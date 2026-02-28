import { DEFAULT_LANG } from '@/const/locale';
import { type Locales } from '@/locales/resources';

import { type GlobalState } from '../initialState';
import { systemStatus } from './systemStatus';

const language = (s: GlobalState) => systemStatus(s).language || 'auto';

const currentLanguage = (s: GlobalState) => {
  const locale = language(s);

  if (locale === 'auto') {
    return DEFAULT_LANG as Locales;
  }

  return locale as Locales;
};

export const globalGeneralSelectors = {
  currentLanguage,
  language,
};
