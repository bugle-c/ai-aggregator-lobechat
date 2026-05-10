'use client';

import { ConfigProvider } from 'antd';
import dayjs from 'dayjs';
import { type PropsWithChildren } from 'react';
import { memo, useEffect, useState } from 'react';
import { isRtlLang } from 'rtl-detect';

import { createI18nNext } from '@/locales/create';
import { isOnServerSide } from '@/utils/env';
import { getAntdLocale } from '@/utils/locale';

import Editor from './Editor';

const updateDayjs = async (lang: string) => {
  // dayjs ships locales as `ru.js`, `en.js`, `zh-cn.js` etc. — the
  // `<lang>-<region>` form rarely exists. Earlier this only mapped
  // `en-us → en` and any region-suffixed locale (`ru-RU`, `pt-BR`)
  // fell through to the catch and dates rendered in English.
  // Try the full lower-cased locale first, then strip the region.
  const lower = lang.toLowerCase();
  const candidates: string[] = [];
  // en-us is special-cased upstream — dayjs distributes it as `en`.
  if (lower === 'en-us') {
    candidates.push('en');
  } else {
    candidates.push(lower);
    const base = lower.split('-')[0];
    if (base && base !== lower) candidates.push(base);
  }

  let dayJSLocale: any;
  for (const candidate of candidates) {
    try {
      dayJSLocale = await import(`dayjs/locale/${candidate}.js`);
      break;
    } catch {
      // try the next candidate
    }
  }

  if (!dayJSLocale) {
    console.warn(`dayjs locale for ${lang} not found, fallback to en`);
    dayJSLocale = await import(`dayjs/locale/en.js`);
  }

  dayjs.locale(dayJSLocale.default);
};

interface LocaleLayoutProps extends PropsWithChildren {
  antdLocale?: any;
  defaultLang?: string;
}

const Locale = memo<LocaleLayoutProps>(({ children, defaultLang, antdLocale }) => {
  const [i18n] = useState(() => createI18nNext(defaultLang));
  const [lang, setLang] = useState(defaultLang);
  const [locale, setLocale] = useState(antdLocale);

  if (isOnServerSide) {
    i18n.init({ initAsync: false });
  } else {
    if (!i18n.instance.isInitialized)
      i18n.init().then(async () => {
        if (!lang) return;

        await updateDayjs(lang);
      });
  }

  // handle i18n instance language change
  useEffect(() => {
    const handleLang = async (lng: string) => {
      setLang(lng);

      if (lang === lng) return;

      const newLocale = await getAntdLocale(lng);
      setLocale(newLocale);

      await updateDayjs(lng);
    };

    i18n.instance.on('languageChanged', handleLang);
    return () => {
      i18n.instance.off('languageChanged', handleLang);
    };
  }, [i18n, lang]);

  // detect document direction
  const documentDir = isRtlLang(lang!) ? 'rtl' : 'ltr';

  return (
    <ConfigProvider
      direction={documentDir}
      locale={locale}
      theme={{
        components: {
          Button: {
            contentFontSizeSM: 12,
          },
        },
      }}
    >
      <Editor>{children}</Editor>
    </ConfigProvider>
  );
});

Locale.displayName = 'Locale';

export default Locale;
