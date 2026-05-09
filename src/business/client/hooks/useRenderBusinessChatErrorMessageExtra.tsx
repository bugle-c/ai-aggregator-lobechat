import { type ChatMessageError } from '@lobechat/types';
import { Block, Button } from '@lobehub/ui';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

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

  if (!error || error.type !== 'PlanLimitExceeded') return null;

  const body = (error.body || {}) as {
    currentPlan?: string;
    modelId?: string;
    requiredPlan?: string;
  };

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
      <Link href="/settings/subscription/plans" style={{ textDecoration: 'none' }}>
        <Button block type="primary">
          {ctaLabel}
        </Button>
      </Link>
    </Block>
  );
}
