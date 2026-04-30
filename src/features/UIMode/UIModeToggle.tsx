'use client';

import { App, Segmented } from 'antd';
import { Settings, Sparkles } from 'lucide-react';
import { memo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';
import { uiModeSelectors } from '@/store/user/slices/uiMode/selectors';

type UiMode = 'light' | 'pro';

/**
 * Top-bar segmented control for toggling between Light and Pro UI modes.
 * Reads/writes the user's `ui_mode` preference via the user store slice
 * (which proxies tRPC `userOnboarding.setUiMode`).
 */
const UIModeToggle = memo(() => {
  const { t } = useTranslation('onboarding');
  const { message } = App.useApp();
  const isLogin = useUserStore(authSelectors.isLogin);
  const current = useUserStore(uiModeSelectors.current);
  const setUiMode = useUserStore((s) => s.setUiMode);
  const loadUiMode = useUserStore((s) => s.loadUiMode);

  // One-shot load on mount (per session). Safe to call multiple times — backend
  // returns the same row, and the slice idempotently sets state.
  useEffect(() => {
    if (isLogin) loadUiMode();
  }, [isLogin, loadUiMode]);

  const onChange = useCallback(
    async (value: string | number) => {
      const next = value as UiMode;
      if (next === current) return;
      try {
        const result = (await setUiMode(next)) as any;
        message.success(next === 'pro' ? t('uiMode.switchedToPro') : t('uiMode.switchedToLight'));
        if (result?.modelWasReset) {
          message.info(t('uiMode.modelResetToWebGPT'));
        }
        // Hard reload to recover from the post-toggle render glitch:
        // changing `uiMode` re-mounts the (main) layout, and the
        // NavPanelPortal subscription dropped during re-mount leaves the
        // sidebar's children unrendered (the DOM is intact — clicks even
        // hit links — but icons/text show as black-on-black until the
        // user manually F5s). Easier than rooting out the race in the
        // portal mechanism. Adds a brief flash but guarantees a clean UI.
        if (typeof window !== 'undefined') {
          // Tiny delay so the success-toast renders first.
          setTimeout(() => window.location.reload(), 250);
        }
      } catch {
        message.error(t('uiMode.switchFailed'));
      }
    },
    [current, setUiMode, t, message],
  );

  if (!isLogin) return null;

  return (
    <Segmented
      size="small"
      value={current}
      options={[
        { icon: <Sparkles size={14} />, label: t('uiMode.light'), value: 'light' },
        { icon: <Settings size={14} />, label: t('uiMode.pro'), value: 'pro' },
      ]}
      onChange={onChange}
    />
  );
});

UIModeToggle.displayName = 'UIModeToggle';

export default UIModeToggle;
