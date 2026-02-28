import { setCookie } from '@lobechat/utils';
import { changeLanguage } from 'i18next';

import { DEFAULT_LANG, LOBE_LOCALE_COOKIE } from '@/const/locale';
import { type LocaleMode } from '@/types/locale';

export const switchLang = (locale: LocaleMode) => {
  const lang = locale === 'auto' ? DEFAULT_LANG : locale;

  changeLanguage(lang);
  document.documentElement.lang = lang;

  setCookie(LOBE_LOCALE_COOKIE, locale === 'auto' ? undefined : locale, 365);
};
