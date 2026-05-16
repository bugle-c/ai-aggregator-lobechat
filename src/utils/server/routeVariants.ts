import type { IRouteVariants, Locales } from '@lobechat/desktop-bridge';
import { RouteVariants as DesktopRouteVariants } from '@lobechat/desktop-bridge';

import { DEFAULT_LANG, LOBE_LOCALE_COOKIE } from '@/const/locale';
import { locales } from '@/locales/resources';
import { type DynamicLayoutProps } from '@/types/next';

export { LOBE_LOCALE_COOKIE };
export { DEFAULT_LANG };
export type { IRouteVariants, Locales };
export { locales };

export const DEFAULT_VARIANTS: IRouteVariants = {
  isMobile: false,
  locale: DEFAULT_LANG as Locales,
};

const isSupportedLocale = (locale: string): locale is Locales =>
  (locales as readonly string[]).includes(locale);

class NextRouteVariants {
  static serializeVariants = DesktopRouteVariants.serializeVariants;

  static deserializeVariants = (variants?: string): IRouteVariants => {
    if (!variants) return DEFAULT_VARIANTS;

    const [locale, isMobileFlag] = variants.split('__');
    if (isMobileFlag === undefined || !locale || !isSupportedLocale(locale))
      return DEFAULT_VARIANTS;

    return DesktopRouteVariants.deserializeVariants(variants);
  };

  static createVariants = (variants: Partial<IRouteVariants> = {}): IRouteVariants => ({
    ...DEFAULT_VARIANTS,
    ...variants,
  });

  static getVariantsFromProps = async (props: DynamicLayoutProps) => {
    const { variants } = await props.params;
    return this.deserializeVariants(variants);
  };

  static getIsMobile = async (props: DynamicLayoutProps) => {
    const { variants } = await props.params;
    const { isMobile } = this.deserializeVariants(variants);
    return isMobile;
  };

  static getLocale = async (props: DynamicLayoutProps) => {
    const { variants } = await props.params;
    const { locale } = this.deserializeVariants(variants);
    return locale;
  };
}

export { NextRouteVariants as RouteVariants };
