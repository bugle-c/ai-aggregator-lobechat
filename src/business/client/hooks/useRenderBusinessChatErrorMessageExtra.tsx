import { type ChatMessageError } from '@lobechat/types';
import { Block, Button } from '@lobehub/ui';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { reachGoal } from '@/business/client/analytics/ym';
import { isCreditsExhaustedChatError } from '@/business/client/creditsExhausted';
import CreditsExhaustedModal from '@/components/CreditsExhaustedModal';
import { useTrackUpsell } from '@/features/Upsell/useTrackUpsell';
import { useChatStore } from '@/store/chat';

/** Auto-open the paywall once per error message per tab session. */
const autoOpenKey = (messageId: string) => `wgpt:exhausted-shown:${messageId}`;
const claimAutoOpen = (messageId: string): boolean => {
  try {
    const key = autoOpenKey(messageId);
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
    return true;
  } catch {
    return true;
  }
};

/**
 * Custom renderer for business-specific chat errors.
 *
 * Currently handles:
 * - `PlanLimitExceeded` — premium-tier model selected on a lower plan.
 *   Shows the human-readable reason + an inline upgrade CTA. Without
 *   this, audit found 16 of 18 plan-blocked users churned silently
 *   (they saw the literal i18n key in the chat).
 * - Credits exhausted — `checkUsageLimit` refusal from the chat route
 *   (`code: 'credits_exhausted'`, generic InternalServerError type). This
 *   is the ONLY place that error reaches the user: the gate runs in the
 *   streaming fetch, after the tRPC sendMessage already persisted the
 *   topic + user message, so it lands on the assistant message
 *   (optimisticUpdateMessageError), never on `inputSendErrorMsg`. Renders
 *   the paywall block, auto-opens CreditsExhaustedModal once per message,
 *   and fires the `paywall_view` goal on every open.
 *
 * Returns `null` for any other error type so the upstream
 * Error/index.tsx default renderer kicks in.
 */
export default function useRenderBusinessChatErrorMessageExtra(
  error: ChatMessageError | null | undefined,
  messageId: string,
) {
  const { t } = useTranslation('error');
  const { click, impression } = useTrackUpsell();
  // SPA navigation — `next/link` would do a full-page reload inside
  // the (main) react-router subtree.
  const navigate = useNavigate();

  const isPlanLimit = !!error && error.type === 'PlanLimitExceeded';
  const isCreditsExhausted = !isPlanLimit && isCreditsExhaustedChatError(error);
  const body = (error?.body || {}) as {
    currentPlan?: string;
    modelId?: string;
    requiredPlan?: string;
  };

  // Contextual paywall: YooKassa returns the payer to this exact chat and
  // the global PaymentReturnHandler picks the result up there.
  const [activeAgentId, activeTopicId] = useChatStore((s) => [s.activeAgentId, s.activeTopicId]);
  const paywallReturnPath = activeAgentId
    ? `/agent/${activeAgentId}${activeTopicId ? `?topic=${activeTopicId}` : ''}`
    : undefined;

  const [exhaustedOpen, setExhaustedOpen] = useState(false);
  const openExhausted = useCallback(() => {
    reachGoal('paywall_view', { source: 'credits_exhausted' });
    setExhaustedOpen(true);
  }, []);

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

  // Credits gone: open the paywall right away, once per message — scrolling
  // back to an old refusal must not pop it again.
  useEffect(() => {
    if (!isCreditsExhausted || !messageId) return;
    if (claimAutoOpen(messageId)) openExhausted();
  }, [isCreditsExhausted, messageId, openExhausted]);

  if (isCreditsExhausted) {
    return (
      <Block padding={16} style={{ width: '100%' }} variant={'outlined'}>
        <div style={{ marginBottom: 12, fontSize: 14, lineHeight: 1.5 }}>
          {t('response.CreditsExhausted.message')}
        </div>
        <Button block type="primary" onClick={openExhausted}>
          {t('response.CreditsExhausted.cta')}
        </Button>
        <CreditsExhaustedModal
          contextNote="Ваш диалог сохранён — после оплаты вы вернётесь ровно сюда"
          open={exhaustedOpen}
          returnPath={paywallReturnPath}
          onClose={() => setExhaustedOpen(false)}
        />
      </Block>
    );
  }

  if (!isPlanLimit) return null;

  const message = t('response.PlanLimitExceeded.message', {
    currentPlan: body.currentPlan ?? '—',
    model: body.modelId ?? '—',
    requiredPlan: body.requiredPlan ?? '—',
  });

  const ctaLabel = t('response.PlanLimitExceeded.cta', {
    plan: body.requiredPlan ?? 'Про',
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
