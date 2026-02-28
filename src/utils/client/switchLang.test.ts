import { setCookie } from '@lobechat/utils';
import { changeLanguage } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_LANG, LOBE_LOCALE_COOKIE } from '@/const/locale';
import { type LocaleMode } from '@/types/locale';

import { switchLang } from './switchLang';

vi.mock('i18next', () => ({
  changeLanguage: vi.fn(),
}));

vi.mock('@lobechat/utils', () => ({
  setCookie: vi.fn(),
}));

describe('switchLang', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should change language to the specified locale', () => {
    const locale: LocaleMode = 'en-US';
    switchLang(locale);

    expect(changeLanguage).toHaveBeenCalledWith(locale);
    expect(document.documentElement.lang).toBe(locale);
    expect(setCookie).toHaveBeenCalledWith(LOBE_LOCALE_COOKIE, locale, 365);
  });

  it('should change language to DEFAULT_LANG when locale is "auto"', () => {
    switchLang('auto');

    expect(changeLanguage).toHaveBeenCalledWith(DEFAULT_LANG);
    expect(document.documentElement.lang).toBe(DEFAULT_LANG);
    expect(setCookie).toHaveBeenCalledWith(LOBE_LOCALE_COOKIE, undefined, 365);
  });
});
