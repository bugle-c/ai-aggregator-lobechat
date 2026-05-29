'use client';

import { ChatInput } from '@lobehub/editor/react';
import { Flexbox, TextArea } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { type KeyboardEvent } from 'react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useImageGenerate } from '@/features/Generators/useImageGenerate';
import { useIsDark } from '@/hooks/useIsDark';
import { useQueryState } from '@/hooks/useQueryParam';
import { useImageStore } from '@/store/image';
import { createImageSelectors } from '@/store/image/selectors';
import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

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
 * Prompt input for image generation.
 *
 * The Sparkles submit button was removed — the page already renders a
 * primary "Создать · ~N кр" CTA below this component (FlowSidebar on
 * desktop, MobileFlowContent on mobile). Two buttons competing for the
 * same action read as a duplicated UI and slow the user down. Enter-to-
 * submit stays so keyboard users don't lose the muscle memory.
 */
const PromptInput = ({ showTitle = false }: PromptInputProps) => {
  const isDarkMode = useIsDark();
  const { t } = useTranslation('image');
  const { value, setValue } = useGenerationConfigParam('prompt');
  const isCreating = useImageStore(createImageSelectors.isCreating);
  const isLogin = useUserStore(authSelectors.isLogin);
  const generate = useImageGenerate();

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

      // Wait one tick so the store-driven `value` propagates before the
      // hook reads `currentModel` etc. 100ms matches the prior behaviour.
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
    </Flexbox>
  );
};

export default PromptInput;
