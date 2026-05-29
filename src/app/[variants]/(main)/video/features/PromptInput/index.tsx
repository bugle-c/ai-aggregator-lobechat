'use client';

import { ChatInput } from '@lobehub/editor/react';
import { Flexbox, TextArea } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import type { KeyboardEvent } from 'react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import VideoFreeQuotaInfo from '@/business/client/features/VideoFreeQuotaInfo';
import { useVideoGenerate } from '@/features/Generators/useVideoGenerate';
import { useIsDark } from '@/hooks/useIsDark';
import { useQueryState } from '@/hooks/useQueryParam';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';
import { useVideoStore } from '@/store/video';
import { createVideoSelectors } from '@/store/video/selectors';
import { useVideoGenerationConfigParam } from '@/store/video/slices/generationConfig/hooks';

import PromptTitle from './Title';

interface PromptInputProps {
  disableAnimation?: boolean;
  showTitle?: boolean;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    box-shadow:
      ${cssVar.boxShadowTertiary},
      0 0 0 ${cssVar.colorBgContainer},
      0 32px 0 ${cssVar.colorBgContainer};
  `,
  container_dark: css`
    box-shadow:
      ${cssVar.boxShadowTertiary},
      0 0 48px 32px ${cssVar.colorBgContainer},
      0 32px 0 ${cssVar.colorBgContainer};
  `,
}));

/**
 * Prompt input for video generation. Same shape as image PromptInput
 * after the single-CTA cleanup — Sparkles submit button removed, Enter
 * still submits. The "Создать · ~N кр" CTA lives in FlowSidebar (desktop)
 * or MobileFlowContent (mobile) and is the single source of truth for
 * triggering generation.
 */
const PromptInput = ({ showTitle = false }: PromptInputProps) => {
  const isDarkMode = useIsDark();
  const { t } = useTranslation('video');
  const { value, setValue } = useVideoGenerationConfigParam('prompt');
  const isCreating = useVideoStore(createVideoSelectors.isCreating);
  const isLogin = useUserStore(authSelectors.isLogin);
  const generate = useVideoGenerate();

  // Read prompt from query parameter
  const [promptParam, setPromptParam] = useQueryState('prompt');
  const hasProcessedPrompt = useRef(false);

  // Auto-fill and auto-send when prompt query parameter is present
  useEffect(() => {
    if (promptParam && !hasProcessedPrompt.current && isLogin) {
      const decodedPrompt = decodeURIComponent(promptParam);
      setValue(decodedPrompt);
      hasProcessedPrompt.current = true;
      setPromptParam(null);
      setTimeout(() => {
        void generate(decodedPrompt);
      }, 100);
    }
  }, [promptParam, isLogin, setValue, setPromptParam, generate]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!isCreating && value.trim()) {
        void generate(value);
      }
    }
  };

  return (
    <Flexbox gap={32} width={'100%'}>
      {showTitle && <PromptTitle />}
      <Flexbox gap={8}>
        <ChatInput
          className={cx(styles.container, isDarkMode && styles.container_dark)}
          styles={{ body: { padding: 8 } }}
        >
          <TextArea
            autoSize={{ maxRows: 6, minRows: 3 }}
            placeholder={t('config.prompt.placeholder')}
            value={value}
            variant={'borderless'}
            style={{
              borderRadius: 0,
              padding: 0,
            }}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </ChatInput>
        <VideoFreeQuotaInfo />
      </Flexbox>
    </Flexbox>
  );
};

export default PromptInput;
