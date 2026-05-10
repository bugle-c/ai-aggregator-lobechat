import { type ChatMessageError } from '@lobechat/types';
import { Block, Button } from '@lobehub/ui';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useTrackUpsell } from '@/features/Upsell/useTrackUpsell';

/**
 * Custom renderer for business-specific chat errors.
 *
 * Currently handles:
 * - `PlanLimitExceeded` — premium-tier model selected on a lower plan.
 *   Shows the human-readable reason + an inline upgrade CTA. Without
 *   this, audit found 16 of 18 plan-blocked users churned silently
 *   (they saw the literal i18n key in the chat).
 *
 * Returns `null` for any other error type so the upstream
 * Error/index.tsx default renderer kicks in.
 */
export default function useRenderBusinessChatErrorMessageExtra(
  error: ChatMessageError | null | undefined,
  _messageId: string,
) {
  const { t } = useTranslation('error');
  const { click, impression } = useTrackUpsell();
  // SPA navigation — `next/link` would do a full-page reload inside
  // the (main) react-router subtree.
  const navigate = useNavigate();

  const isPlanLimit = !!error && error.type === 'PlanLimitExceeded';
  const body = (error?.body || {}) as {
    currentPlan?: string;
    modelId?: string;
    requiredPlan?: string;
  };

  // Fire impression when the renderer mounts for a plan-limit error.
  // The block stays in the chat lane until the next user message, so
  // impression-per-mount accurately reflects "user actually saw the upsell".
  useEffect(() => {
    if (isPlanLimit) {
      impression('plan_limit_chat', {
        modelBlocked: body.modelId,
        planOffered: body.requiredPlan,
      });
    }
  }, [isPlanLimit, body.modelId, body.requiredPlan, impression]);

  if (!isPlanLimit) return null;

  const message = t('response.PlanLimitExceeded.message', {
    currentPlan: body.currentPlan ?? '—',
    model: body.modelId ?? '—',
    requiredPlan: body.requiredPlan ?? '—',
  });

  const ctaLabel = t('response.PlanLimitExceeded.cta', {
    plan: body.requiredPlan ?? 'Pro',
  });

  return (
    <Block padding={16} style={{ width: '100%' }} variant={'outlined'}>
      <div style={{ marginBottom: 12, fontSize: 14, lineHeight: 1.5 }}>{message}</div>
      <Button
        block
        type="primary"
        onClick={() => {
          click('plan_limit_chat', { targetPlan: body.requiredPlan });
          navigate('/settings/plans?utm_source=plan_limit_chat');
        }}
      >
        {ctaLabel}
      </Button>
    </Block>
  );
}
