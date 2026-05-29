'use client';

import { ChatInput } from '@lobehub/editor/react';
import { Button, Flexbox, TextArea } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { Sparkles } from 'lucide-react';
import { type KeyboardEvent } from 'react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { loginRequired } from '@/components/Error/loginRequiredNotification';
import { useFlowUrlState } from '@/features/Generators/useFlowUrlState';
import { useGenerationCostPreview } from '@/features/Generators/useGenerationCostPreview';
import { useGeminiChineseWarning } from '@/hooks/useGeminiChineseWarning';
import { useIsDark } from '@/hooks/useIsDark';
import { useQueryState } from '@/hooks/useQueryParam';
import { useImageStore } from '@/store/image';
import { createImageSelectors } from '@/store/image/selectors';
import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';
import { imageGenerationConfigSelectors } from '@/store/image/slices/generationConfig/selectors';
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

const PromptInput = ({ showTitle = false }: PromptInputProps) => {
  const isDarkMode = useIsDark();
  const { t } = useTranslation('image');
  const { message } = App.useApp();
  const url = useFlowUrlState('presets');
  const { value, setValue } = useGenerationConfigParam('prompt');
  const isCreating = useImageStore(createImageSelectors.isCreating);
  const createImage = useImageStore((s) => s.createImage);
  const currentModel = useImageStore(imageGenerationConfigSelectors.model);
  const imageNum = useImageStore(imageGenerationConfigSelectors.imageNum);
  const isLogin = useUserStore(authSelectors.isLogin);
  const checkGeminiChineseWarning = useGeminiChineseWarning();
  // Live cost preview: shows the credit count inside the Sparkles button so
  // the user knows what they're about to spend before pressing it. Server
  // re-uses calculateCreditsAsync so this can never disagree with the bill.
  const cost = useGenerationCostPreview({ images: imageNum, kind: 'image', model: currentModel });

  // Read prompt from query parameter
  const [promptParam, setPromptParam] = useQueryState('prompt');
  const hasProcessedPrompt = useRef(false);

  const handleGenerate = async () => {
    if (!isLogin) {
      loginRequired.redirect({ timeout: 2000 });
      return;
    }
    // Check for Chinese text warning with Gemini model
    const shouldContinue = await checkGeminiChineseWarning({
      model: currentModel,
      prompt: value,
      scenario: 'image',
    });

    if (!shouldContinue) return;

    // Switch to the "Мои генерации" tab — the embedded
    // ResourceExplorer keeps the user on the same page (no /resource
    // hop), so the creation surface is one click away while previous
    // results stay visible.
    url.setTab('feed');
    message.success({ content: 'Генерация запущена', duration: 1.5 });
    void createImage();
  };

  // Auto-fill and auto-send when prompt query parameter is present
  useEffect(() => {
    if (promptParam && !hasProcessedPrompt.current && isLogin) {
      // Decode the prompt parameter
      const decodedPrompt = decodeURIComponent(promptParam);

      // Set the prompt value in the store
      setValue(decodedPrompt);

      // Mark as processed to avoid running this effect again
      hasProcessedPrompt.current = true;

      // Clear the query parameter
      setPromptParam(null);

      // Auto-trigger generation after a short delay to ensure state is updated
      setTimeout(async () => {
        const shouldContinue = await checkGeminiChineseWarning({
          model: currentModel,
          prompt: decodedPrompt,
          scenario: 'image',
        });

        if (shouldContinue) {
          await createImage();
        }
      }, 100);
    }
  }, [
    promptParam,
    isLogin,
    setValue,
    setPromptParam,
    checkGeminiChineseWarning,
    currentModel,
    createImage,
  ]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!isCreating && value.trim()) {
        handleGenerate();
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
        <Flexbox horizontal align="flex-end" gap={12} height={'100%'} width={'100%'}>
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
          <Button
            danger={cost.credits != null && !cost.sufficient}
            disabled={!value}
            icon={Sparkles}
            loading={isCreating}
            size={'large'}
            type={'primary'}
            style={{
              fontWeight: 500,
              height: 64,
              minWidth: 64,
              // When we have a cost number, widen the button so the icon
              // + number fit on one row without crowding. Idle keeps the
              // original 64×64 square so layout doesn't jump on load.
              width: cost.credits != null ? 'auto' : 64,
              paddingInline: cost.credits != null ? 14 : undefined,
            }}
            title={
              isCreating
                ? t('generation.status.generating')
                : cost.credits != null
                  ? `${t('generation.actions.generate')} · ~${cost.credits} кр${
                      cost.sufficient ? '' : ' (не хватает баланса)'
                    }`
                  : t('generation.actions.generate')
            }
            onClick={handleGenerate}
          >
            {/* Render the number alongside the icon. The Sparkles icon stays
                visible via the `icon` prop above; this is just the suffix. */}
            {cost.credits != null ? (
              <span style={{ fontWeight: 600, marginInlineStart: 4 }}>~{cost.credits}</span>
            ) : null}
          </Button>
        </Flexbox>
      </ChatInput>
    </Flexbox>
  );
};

export default PromptInput;
