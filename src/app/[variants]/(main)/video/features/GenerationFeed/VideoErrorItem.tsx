'use client';

import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { Block, Center, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { VideoOffIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionButtons } from '@/app/[variants]/(main)/image/features/GenerationFeed/GenerationItem/ActionButtons';
import { styles } from '@/app/[variants]/(main)/image/features/GenerationFeed/GenerationItem/styles';
import { friendlyGenerationError } from '@/business/utils/friendlyError';
import type { Generation } from '@/types/generation';

interface VideoErrorItemProps {
  aspectRatio?: string;
  generation: Generation;
  onCopyError: () => void;
  onDelete: () => void;
}

const VideoErrorItem = memo<VideoErrorItemProps>(
  ({ generation, aspectRatio, onDelete, onCopyError }) => {
    const { t } = useTranslation('video');
    const { t: tError } = useTranslation('error');

    const errorMessage = useMemo(() => {
      if (!generation.task.error) return '';

      const error = generation.task.error;
      // Only ever hand React a string: `body.detail` can itself be an object
      // (tRPC / WaveSpeed envelopes), which crashed the whole feed with React
      // error #31 (2026-09-23). Non-string bodies go through friendlyGenerationError.
      const errorBody =
        typeof error.body === 'string'
          ? error.body
          : typeof error.body?.detail === 'string'
            ? error.body.detail
            : undefined;

      if (errorBody) {
        const knownErrorTypes = Object.values(AgentRuntimeErrorType);
        if (
          knownErrorTypes.includes(
            errorBody as (typeof AgentRuntimeErrorType)[keyof typeof AgentRuntimeErrorType],
          )
        ) {
          const translationKey = `response.${errorBody}`;
          const translated = tError(translationKey as any);

          if (translated === translationKey || (translated as string).startsWith('response.')) {
            const directTranslated = tError(errorBody as any);
            if (directTranslated !== errorBody) {
              return directTranslated as string;
            }
            return errorBody;
          }

          return translated as string;
        }
      }

      // Raw upstream text (WaveSpeed `400 {...}`, tRPC detail) never reaches
      // the customer — collapse to one sentence. See business/utils/friendlyError.
      return friendlyGenerationError(errorBody || error.body || error.name);
    }, [generation.task.error, tError]);

    return (
      <Block
        align={'center'}
        className={styles.placeholderContainer}
        justify={'center'}
        padding={16}
        variant={'filled'}
        style={{
          aspectRatio: aspectRatio?.includes(':') ? aspectRatio.replace(':', '/') : '16/9',
          cursor: 'pointer',
          width: '100%',
        }}
        onClick={onCopyError}
      >
        <Center gap={8}>
          <Icon color={cssVar.colorTextDescription} icon={VideoOffIcon} size={24} />
          <Text strong type={'secondary'}>
            {t('generation.status.failed')}
          </Text>
          {generation.task.error && (
            <Text
              code
              ellipsis={{ rows: 2 }}
              fontSize={10}
              title={t('generation.actions.copyError')}
              type={'secondary'}
              style={{
                wordBreak: 'break-all',
              }}
            >
              {errorMessage}
            </Text>
          )}
        </Center>
        <ActionButtons onDelete={onDelete} />
      </Block>
    );
  },
);

VideoErrorItem.displayName = 'VideoErrorItem';

export default VideoErrorItem;
