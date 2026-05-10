'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Typography } from 'antd';
import { Sparkles } from 'lucide-react';
import { memo } from 'react';
import { useNavigate } from 'react-router-dom';

import { lambdaQuery } from '@/libs/trpc/client';

/**
 * Free-plan gate banner for the /video page.
 *
 * Every active video rate in admin model_rates is mid-tier or higher
 * ($0.077/sec → mid for the cheapest Seedance 2.0 Fast). free users have
 * no usable model — chargeBeforeGenerate 403s every click. Without this
 * banner the page just looks empty + every model has a lock icon, with
 * no clear path to "what now?".
 *
 * Shown only when:
 *   - user is logged in (creditState resolved)
 *   - planSlug === 'free'
 *
 * On any paid plan (basic / pro / pro_max) the banner is hidden.
 */
const PlanGateBanner = memo(() => {
  // SPA navigation — `next/navigation`'s router doesn't drive the
  // react-router subtree under (main).
  const navigate = useNavigate();
  const { data } = lambdaQuery.spend.getCreditState.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });
  const planSlug = data?.planSlug;

  // Wait for the plan to load — don't flash the banner for paid users.
  if (!planSlug || planSlug !== 'free') return null;

  return (
    <Flexbox
      horizontal
      align="center"
      gap={16}
      justify="space-between"
      style={{
        background: 'linear-gradient(90deg, rgba(99,102,241,0.12), rgba(168,85,247,0.12))',
        border: '1px solid rgba(99,102,241,0.25)',
        borderRadius: 12,
        margin: '12px 16px',
        padding: '14px 18px',
      }}
    >
      <Flexbox horizontal align="center" gap={12}>
        <Sparkles color="#a78bfa" size={22} />
        <Flexbox gap={2}>
          <Typography.Text strong style={{ fontSize: 15 }}>
            Видео-генерация — функция платных тарифов
          </Typography.Text>
          {/* Skip type="secondary" — on the tinted banner bg the muted
              grey rendered too pale in light theme. Plain Text uses the
              default text color which adapts to the theme. */}
          <Typography.Text style={{ fontSize: 13, opacity: 0.85 }}>
            На «Старт» бесплатно доступен только чат и базовые картинки. Откройте Sora 2, Veo 3.1,
            Kling 3 и другие модели на тарифе Basic — от 490 ₽/мес.
          </Typography.Text>
        </Flexbox>
      </Flexbox>
      <Button size="middle" type="primary" onClick={() => navigate('/settings/plans')}>
        Выбрать тариф
      </Button>
    </Flexbox>
  );
});

PlanGateBanner.displayName = 'PlanGateBanner';

export default PlanGateBanner;
