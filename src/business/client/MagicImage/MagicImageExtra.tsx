'use client';

import { copyToClipboard,Flexbox } from '@lobehub/ui';
import { App, Button, Skeleton, Typography } from 'antd';
import { memo, useState } from 'react';

import { reachGoal } from '@/business/client/analytics/ym';
import { lambdaQuery } from '@/libs/trpc/client';
import { useChatStore } from '@/store/chat';
import { displayMessageSelectors } from '@/store/chat/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import { isMagicImageDone, useMagicImage } from './useMagicImage';

const { Text } = Typography;

const TG_BOT_URL = 'https://t.me/gptwebrubot';

/** Wrap the assistant's answer into an illustration prompt (RU product surface). */
const buildImagePrompt = (content: string) => {
  const text = content.trim().slice(0, 400);
  return `Иллюстрация к тексту: ${text}. Яркая, современная, фотореалистичная, без текста и надписей на изображении`;
};

interface MagicImageExtraProps {
  content: string;
  id: string;
}

/**
 * The "earned magic" inline block under the LAST assistant message:
 * after >= 2 meaningful user messages an onboarded (intent-set) user gets a
 * one-shot free image generated right in the chat, with a value recap and a
 * Telegram hook. Users in the `doc` intent get a copy-to-clipboard action
 * instead. Copy is intentionally hardcoded Russian — business component,
 * RU-only product surface (same as CreditsExhaustedModal).
 */
const MagicImageExtra = memo<MagicImageExtraProps>(({ content, id }) => {
  const { message } = App.useApp();

  // One-shot: never re-show the CTA after a successful image (survives reloads).
  const [done] = useState(isMagicImageDone);

  const isLogin = useUserStore(authSelectors.isLogin);
  const lastMessageId = useChatStore(displayMessageSelectors.lastDisplayMessageId);
  const meaningfulUserMessages = useChatStore(
    (s) =>
      displayMessageSelectors
        .activeDisplayMessages(s)
        .filter((m) => m.role === 'user' && m.content.trim().length >= 10).length,
  );
  const firstMessageAt = useChatStore(
    (s) => displayMessageSelectors.activeDisplayMessages(s)[0]?.createdAt,
  );

  const isLast = id === lastMessageId;
  const baseGate = isLogin && isLast && meaningfulUserMessages >= 2 && !done;

  const { data: onboarding } = lambdaQuery.userOnboarding.getOnboardingState.useQuery(undefined, {
    enabled: baseGate,
  });

  const { generate, imageUrl, status } = useMagicImage();

  // Onboarding cohort only: users that picked an intent chip.
  if (!baseGate || !onboarding?.intent) return null;

  // `doc` intent: the magic moment is a ready-to-paste document, not an image.
  if (onboarding.intent === 'doc') {
    return (
      <div>
        <Button
          size="small"
          onClick={async () => {
            await copyToClipboard(content);
            message.success('Документ скопирован');
          }}
        >
          📋 Скопировать документ
        </Button>
      </div>
    );
  }

  switch (status) {
    case 'idle': {
      return (
        <div>
          <Button
            size="small"
            onClick={() => {
              reachGoal('earned_magic_unlock');
              generate(buildImagePrompt(content));
            }}
          >
            🎨 Сделать картинку к этому — бесплатно
          </Button>
        </div>
      );
    }

    case 'generating': {
      return (
        <Flexbox gap={8}>
          <Skeleton.Image active style={{ borderRadius: 12, height: 200, width: 320 }} />
          <Text type="secondary">Рисуем картинку… ~20 секунд</Text>
        </Flexbox>
      );
    }

    case 'success': {
      const minutes = firstMessageAt
        ? Math.max(1, Math.round((Date.now() - firstMessageAt) / 60_000))
        : 5;
      return (
        <Flexbox gap={8}>
          {imageUrl && (
            <img
              alt="Сгенерированная картинка"
              src={imageUrl}
              style={{ borderRadius: 12, maxWidth: 360, width: '100%' }}
            />
          )}
          <Text type="secondary">
            За {minutes} минут: текст + картинка. У дизайнера это ~1500₽
          </Text>
          <Flexbox horizontal gap={8}>
            <Button download href={imageUrl} size="small">
              Скачать
            </Button>
            <Button
              href={TG_BOT_URL}
              size="small"
              target="_blank"
              type="primary"
              onClick={() => reachGoal('magic_complete')}
            >
              Продолжить в Telegram
            </Button>
          </Flexbox>
        </Flexbox>
      );
    }

    case 'error': {
      return <Text type="secondary">Не получилось сгенерировать — кредиты не списаны</Text>;
    }

    default: {
      // 'hidden' — the server gate said not yet.
      return null;
    }
  }
});

MagicImageExtra.displayName = 'MagicImageExtra';

export default MagicImageExtra;
