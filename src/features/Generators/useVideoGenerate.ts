'use client';

import { App } from 'antd';
import { useCallback } from 'react';

import { friendlyGenerationError } from '@/business/utils/friendlyError';
import { loginRequired } from '@/components/Error/loginRequiredNotification';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';
import { useVideoStore } from '@/store/video';

import { useFlowUrlState } from './useFlowUrlState';

/**
 * Mirror of useImageGenerate for the video flow. No Gemini Chinese check
 * here — that's image-only; video uses Wavespeed-routed models that
 * accept Cyrillic prompts natively. Otherwise identical pipeline:
 *   1. Login check
 *   2. Switch the explorer to "Мои генерации"
 *   3. Toast confirmation
 *   4. Fire createVideo()
 *
 * Accepts the current prompt for symmetry with useImageGenerate even
 * though we don't currently do anything with it — keeps the call sites
 * looking the same and leaves room for adding a video-specific prompt
 * validation later (e.g. NSFW prefilter).
 */
export function useVideoGenerate() {
  const { message } = App.useApp();
  const url = useFlowUrlState('presets');
  const createVideo = useVideoStore((s) => s.createVideo);
  const isLogin = useUserStore(authSelectors.isLogin);

  return useCallback(
    async (_prompt: string) => {
      if (!isLogin) {
        loginRequired.redirect({ timeout: 2000 });
        return;
      }
      url.setTab('feed');
      message.success({ content: 'Генерация запущена', duration: 1.5 });
      try {
        await createVideo();
      } catch (error) {
        // The precharge gate refuses with a Russian sentence (plan / free
        // trial / credits); provider payloads get the friendly mapping.
        const raw = error instanceof Error ? error.message : String(error ?? '');
        const text = /\p{Script=Cyrillic}/u.test(raw) ? raw : friendlyGenerationError(raw);
        message.error({ content: text, duration: 6 });
      }
    },
    [createVideo, isLogin, message, url],
  );
}
