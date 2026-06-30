'use client';

import { Alert, Button, Flexbox } from '@lobehub/ui';
import { Settings2, TrendingUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { memo, useEffect, useState } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';

import { messageStateSelectors, useConversationStore } from '../../store';

/**
 * Shown inline in an assistant message bubble when generation has been
 * running for more than `thresholdSec` seconds (default 15).
 *
 * Tier-specific CTAs:
 *   - free  → both "switch to faster cloud model" and "upgrade to Basic"
 *   - basic → "upgrade to Pro" (faster models bundled in higher tier)
 *   - pro   → "upgrade to Pro Max"
 *   - pro_max → no banner (no further tier to sell)
 *
 * The component self-resets when the message finishes generating; nothing
 * to dismiss manually. Adds no network calls beyond the existing
 * getBillingState query that the rest of the app already runs.
 */
interface Props {
  /** Bubble seconds before banner appears. Default 15. */
  messageId: string;
  thresholdSec?: number;
}

const SETTINGS_MODELS_HREF = '/settings/agent';
const PLANS_HREF = '/settings/plans';

const SlowResponseBanner = memo<Props>(({ messageId, thresholdSec = 15 }) => {
  const router = useRouter();
  const generating = useConversationStore(messageStateSelectors.isMessageGenerating(messageId));

  const [show, setShow] = useState(false);

  // Only fetch billing state when we actually need it (lazy, deferred). The
  // useQuery cache is shared across components so this doesn't trigger an
  // extra round-trip in practice.
  const { data: billing } = lambdaQuery.subscription.getBillingState.useQuery(undefined, {
    enabled: show,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!generating) {
      setShow(false);
      return;
    }
    const timer = setTimeout(() => setShow(true), thresholdSec * 1000);
    return () => clearTimeout(timer);
  }, [generating, thresholdSec]);

  if (!show || !generating) return null;

  const planSlug = billing?.plan?.slug ?? 'free';

  const config = (() => {
    switch (planSlug) {
      case 'free': {
        return {
          message:
            'Подождите ещё немного — или попробуйте быструю облачную модель прямо сейчас. На Basic-тарифе доступны GPT-5 Mini и Claude Haiku 4.5 — обычно отвечают за 3–5 секунд.',
          primary: {
            label: 'Подключить Basic — 490 ₽/мес',
            onClick: () => router.push(PLANS_HREF),
          },
          secondary: {
            label: 'Сменить модель',
            onClick: () => router.push(SETTINGS_MODELS_HREF),
          },
        };
      }
      case 'basic': {
        return {
          message:
            'На тарифе Pro подключены премиум-модели Claude / GPT с приоритетной очередью — ответ за 2–3 секунды даже на длинных промптах.',
          primary: { label: 'Перейти на Pro', onClick: () => router.push(PLANS_HREF) },
        };
      }
      case 'pro': {
        return {
          message:
            'На Pro Max нет ограничений по контексту и доступны самые быстрые версии Claude и GPT.',
          primary: { label: 'Перейти на Pro Max', onClick: () => router.push(PLANS_HREF) },
        };
      }
      default: {
        return null;
      }
    }
  })();

  if (!config) return null;

  return (
    <Alert
      showIcon
      style={{ marginBottom: 8 }}
      type="info"
      message={
        <Flexbox gap={8}>
          <strong>Ответ занимает дольше обычного</strong>
          <span style={{ fontSize: 13 }}>{config.message}</span>
          <Flexbox horizontal gap={8}>
            <Button
              icon={<TrendingUp size={14} />}
              size="small"
              type="primary"
              onClick={config.primary.onClick}
            >
              {config.primary.label}
            </Button>
            {'secondary' in config && config.secondary && (
              <Button
                icon={<Settings2 size={14} />}
                size="small"
                onClick={config.secondary.onClick}
              >
                {config.secondary.label}
              </Button>
            )}
          </Flexbox>
        </Flexbox>
      }
    />
  );
});

SlowResponseBanner.displayName = 'SlowResponseBanner';

export default SlowResponseBanner;
