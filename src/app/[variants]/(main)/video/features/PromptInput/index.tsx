'use client';

import { ChatInput } from '@lobehub/editor/react';
import { Button, Flexbox, TextArea } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { Sparkles } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import VideoFreeQuotaInfo from '@/business/client/features/VideoFreeQuotaInfo';
import { loginRequired } from '@/components/Error/loginRequiredNotification';
import { useFlowUrlState } from '@/features/Generators/useFlowUrlState';
import { useGenerationCostPreview } from '@/features/Generators/useGenerationCostPreview';
import { useIsDark } from '@/hooks/useIsDark';
import { useQueryState } from '@/hooks/useQueryParam';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';
import { useVideoStore } from '@/store/video';
import { createVideoSelectors } from '@/store/video/selectors';
import { useVideoGenerationConfigParam } from '@/store/video/slices/generationConfig/hooks';
import { videoGenerationConfigSelectors } from '@/store/video/slices/generationConfig/selectors';

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
  const { t } = useTranslation('video');
  const { message } = App.useApp();
  const url = useFlowUrlState('presets');
  const { value, setValue } = useVideoGenerationConfigParam('prompt');
  const isCreating = useVideoStore(createVideoSelectors.isCreating);
  const createVideo = useVideoStore((s) => s.createVideo);
  const isLogin = useUserStore(authSelectors.isLogin);
  const currentModel = useVideoStore(videoGenerationConfigSelectors.model);
  const videoParameters = useVideoStore(videoGenerationConfigSelectors.parameters);
  // Wavespeed bills per second; pull duration straight from the param store.
  // Fallback to 5 — the most common default across kling/seedance/veo/wan —
  // so the preview shows a reasonable estimate even before the user touches
  // the slider.
  const durationSeconds = Number(videoParameters?.duration ?? 5) || 5;
  const cost = useGenerationCostPreview({
    durationSeconds,
    kind: 'video',
    model: currentModel,
  });

  // Read prompt from query parameter
  const [promptParam, setPromptParam] = useQueryState('prompt');
  const hasProcessedPrompt = useRef(false);

  const handleGenerate = async () => {
    if (!isLogin) {
      loginRequired.redirect({ timeout: 2000 });
      return;
    }

    // Switch to "Мои генерации" — the embedded ResourceExplorer
    // shows all videos including the skeleton tile for the
    // in-flight one.
    url.setTab('feed');
    message.success({ content: 'Генерация запущена', duration: 1.5 });
    void createVideo();
  };

  // Auto-fill and auto-send when prompt query parameter is present
  useEffect(() => {
    if (promptParam && !hasProcessedPrompt.current && isLogin) {
      const decodedPrompt = decodeURIComponent(promptParam);

      setValue(decodedPrompt);

      hasProcessedPrompt.current = true;

      setPromptParam(null);

      setTimeout(async () => {
        await createVideo();
      }, 100);
    }
  }, [promptParam, isLogin, setValue, setPromptParam, createVideo]);

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
      <Flexbox gap={8}>
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
              {cost.credits != null ? (
                <span style={{ fontWeight: 600, marginInlineStart: 4 }}>~{cost.credits}</span>
              ) : null}
            </Button>
          </Flexbox>
        </ChatInput>
        <VideoFreeQuotaInfo />
      </Flexbox>
    </Flexbox>
  );
};

export default PromptInput;
