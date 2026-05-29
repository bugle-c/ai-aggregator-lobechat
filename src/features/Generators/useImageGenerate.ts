'use client';

import { App } from 'antd';
import { useCallback } from 'react';

import { loginRequired } from '@/components/Error/loginRequiredNotification';
import { useGeminiChineseWarning } from '@/hooks/useGeminiChineseWarning';
import { useImageStore } from '@/store/image';
import { imageGenerationConfigSelectors } from '@/store/image/slices/generationConfig/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import { useFlowUrlState } from './useFlowUrlState';

/**
 * Single source of truth for "user wants to make an image now". Wraps the
 * full generate flow:
 *   1. Login check (anon visitor → 2-sec login-required redirect)
 *   2. Gemini Chinese-input warning (model-specific quality hint)
 *   3. Switch the embedded explorer to the "Мои генерации" tab so the
 *      skeleton tile is visible right away
 *   4. Toast confirmation
 *   5. Fire createImage()
 *
 * Previously this logic was duplicated in PromptInput (called from the
 * textarea's Sparkles submit button) and partially in MobileFlowContent
 * (skipped login + Chinese check). With multiple CTAs on the page now
 * (textarea submit + bottom Создать button), every surface needs the same
 * behaviour — putting it in a hook eliminates the divergence.
 *
 * Returns a stable callback that takes the current prompt string.
 */
export function useImageGenerate() {
  const { message } = App.useApp();
  const url = useFlowUrlState('presets');
  const createImage = useImageStore((s) => s.createImage);
  const currentModel = useImageStore(imageGenerationConfigSelectors.model);
  const isLogin = useUserStore(authSelectors.isLogin);
  const checkGeminiChineseWarning = useGeminiChineseWarning();

  return useCallback(
    async (prompt: string) => {
      if (!isLogin) {
        loginRequired.redirect({ timeout: 2000 });
        return;
      }

      const shouldContinue = await checkGeminiChineseWarning({
        model: currentModel,
        prompt,
        scenario: 'image',
      });
      if (!shouldContinue) return;

      url.setTab('feed');
      // Mobile callers also want the create sheet to close — they
      // can read `view` separately and clear it. Keeping that decision
      // outside this hook so the desktop callsite doesn't need to know
      // about it.
      message.success({ content: 'Генерация запущена', duration: 1.5 });
      await createImage();
    },
    [checkGeminiChineseWarning, createImage, currentModel, isLogin, message, url],
  );
}
