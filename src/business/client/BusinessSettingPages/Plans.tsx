'use client';

import { Flexbox, Grid } from '@lobehub/ui';
import {
  App,
  Button,
  Card,
  Divider,
  Input,
  Modal,
  Progress,
  Radio,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { Check } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';
import { reachGoal } from '@/business/client/analytics/ym';
import { FREE_DAILY_MESSAGE_QUOTA_HINT, freeQuotaOf } from '@/business/client/balanceView';
import IntroOfferBanner from '@/business/client/IntroOffer/IntroOfferBanner';
import {
  RECURRING_CONSENT_VERSION,
  RECURRING_PAY_LABEL,
  recurringConsentText,
} from '@/business/client/recurringDisclosure';
import { creditsToHuman } from '@/business/utils/creditsToHuman';
import PaymentTrustBadges from '@/components/PaymentTrustBadges';
import { SubscriptionActivatedModal } from '@/features/SubscriptionActivatedModal';
import MobileCancelFlow from '@/features/Upsell/MobileCancelFlow';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useQueryState } from '@/hooks/useQueryParam';
import { lambdaClient, lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import FreeQuotaSummary from './FreeQuotaSummary';
import PlansMobileLayout from './PlansMobileLayout';

const CANCEL_REASONS: { code: string; label: string }[] = [
  { code: 'too_expensive', label: 'Слишком дорого' },
  { code: 'not_using', label: 'Перестал пользоваться' },
  { code: 'missing_feature', label: 'Не хватает функций' },
  { code: 'switched', label: 'Перешёл на другой сервис' },
  { code: 'temporary', label: 'Временно — потом вернусь' },
  { code: 'other', label: 'Другое' },
];

const { Text, Title } = Typography;

// Approximate messages per credit (1 credit ≈ 1 message). The free card
// states its daily quota outright (EXP-003), so it carries no hint.
const MESSAGES_HINT: Record<string, string> = {
  basic: '~33 сообщений/день',
  pro: '~330 сообщений/день',
};

const PLAN_FEATURES: Record<string, string[]> = {
  basic: ['plans.features.allModels', 'plans.features.priority'],
  free: ['plans.features.allModels'],
  pro: ['plans.features.allModels', 'plans.features.priority', 'plans.features.earlyAccess'],
};

const Plans = memo(() => {
  const { t } = useTranslation('subscription');
  const { message } = App.useApp();
  const utils = lambdaQuery.useUtils();

  // Cancellation modal state — kept inside the component so the modal
  // closes correctly on success and re-opens on the next click.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState<string>('not_using');
  const [cancelText, setCancelText] = useState('');
  const [cancelling, setCancelling] = useState(false);

  // Saved-card removal state. Required by YooKassa for recurring approval.
  const [removeCardOpen, setRemoveCardOpen] = useState(false);
  const [removingCard, setRemovingCard] = useState(false);

  // Recovery modal — shown once per session if the user has a canceled
  // or expired checkout in the last 24h. Three exits: retry same plan,
  // enter promo, or contact support.
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryDismissed, setRecoveryDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem('wgpt:recovery-dismissed') === '1';
  });
  const [promoInput, setPromoInput] = useState('');
  const [promoRedeeming, setPromoRedeeming] = useState(false);

  // Post-payment success: replaces the old 4-second toast with the
  // SubscriptionActivatedModal (what you got + one-click model switch +
  // a way back into the chat).
  const [activatedPlan, setActivatedPlan] = useState<{
    planName: string | null;
    planSlug: string | null;
  } | null>(null);

  // IMPORTANT: keep all hooks above any early-return.
  // useIsMobile() wraps antd-style useResponsive() which calls useRef
  // internally. Calling it after a conditional return causes React #310
  // ("Rendered more hooks than during the previous render") when the
  // loading branch resolves and the component re-renders with one
  // additional hook in scope.
  const isMobile = useIsMobile();
  const isLogin = useUserStore(authSelectors.isLogin);

  // Metrika funnel: the plans page IS the paywall — one view per mount.
  useEffect(() => {
    reachGoal('paywall_view', { source: 'plans_page' });
  }, []);

  // Gate behind auth — these are authedProcedures that throw UNAUTHORIZED
  // for anonymous users. Without `enabled` the page hits an error
  // boundary on deep-link arrivals (e.g. ad CTA → /settings/plans).
  const { data: plans, isLoading: plansLoading } = lambdaQuery.subscription.getPlans.useQuery(
    undefined,
    { enabled: isLogin },
  );
  const { data: billing, isLoading: billingLoading } =
    lambdaQuery.subscription.getBillingState.useQuery(undefined, { enabled: isLogin });
  const { data: packages } = lambdaQuery.topUp.getPackages.useQuery(undefined, {
    enabled: isLogin,
  });
  // EXP-003: free users see today's message allowance, not the monthly
  // credit cap. Same query the header badge keeps warm (shared cache).
  const { data: creditState } = lambdaQuery.spend.getCreditState.useQuery(undefined, {
    enabled: isLogin,
  });

  // Two ways the recovery modal can fire:
  //   1. URL ?recoveryFor=<payment-id> — set on the YooKassa return_url.
  //      We poll that payment's status for a few seconds (webhook lag);
  //      if it lands on succeeded we celebrate, otherwise we open the
  //      recovery modal AND prefill `recoveryAttempt` with that row.
  //   2. Fallback: last 24h canceled/failed/pending payment — picked up
  //      on a fresh /settings/plans visit (user navigated manually,
  //      not via YK redirect).
  const [recoveryForId, setRecoveryForId] = useQueryState('recoveryFor');
  const [recoveryPollEnabled, setRecoveryPollEnabled] = useState(false);
  const [retryAttempts, setRetryAttempts] = useState(0);
  // The effect below can re-run for a few render cycles after a terminal
  // status while nuqs clears the URL param — a duplicate toast is harmless,
  // a duplicate Metrika conversion is not. Fire each outcome goal once per
  // payment id.
  const trackedPaymentId = useRef<string | null>(null);
  const trackPaymentOutcome = (
    paymentId: string,
    goal: string,
    params: Record<string, unknown>,
  ) => {
    if (trackedPaymentId.current === paymentId) return;
    trackedPaymentId.current = paymentId;
    reachGoal(goal, params);
  };
  const { data: redirectedPayment } = lambdaQuery.subscription.getPaymentStatus.useQuery(
    { id: recoveryForId || '' },
    {
      enabled: isLogin && !!recoveryForId,
      // Poll a few seconds because YK redirects before our webhook lands
      refetchInterval: recoveryPollEnabled ? 1500 : false,
    },
  );

  const { data: fallbackAttempt } = lambdaQuery.subscription.getRecentFailedAttempt.useQuery(
    undefined,
    { enabled: isLogin && !recoveryForId },
  );

  // Drive the URL-based recovery flow.
  //
  // IMPORTANT: do NOT put `utils.subscription.getBillingState` in the deps
  // array. tRPC's `useUtils()` returns a stable outer `utils` object, but
  // each `utils.foo.bar` access goes through a Proxy that creates a NEW
  // descendant proxy reference on every render. Putting that in deps
  // makes the effect think its deps changed every render, fires the
  // effect every render, calls setState (e.g. `setRetryAttempts(n+1)`),
  // re-renders, etc. → React error #185 "Maximum update depth exceeded".
  //
  // Call the invalidate via the captured-but-not-deps `utils` ref. This
  // is the standard tRPC pattern (see https://trpc.io/docs/client/react/useUtils).
  useEffect(() => {
    if (!recoveryForId) return;
    // Start polling on first mount with the param.
    //
    // CRITICAL: guard the reset path with `retryAttempts === 0`. Without
    // it, after a terminal branch sets `recoveryPollEnabled=false` +
    // `setRecoveryForId(null)`, nuqs queues the URL update asynchronously
    // — for several React render cycles, `recoveryForId` is still the old
    // value while `recoveryPollEnabled` is already false. The effect then
    // re-enters THIS branch, re-enables polling, resets retryAttempts to
    // 0 → oscillation → React #185. The `retryAttempts === 0` guard makes
    // this branch fire ONLY on true initial mount (state never gets back
    // to 0 + recoveryPollEnabled=false combination after the first run).
    if (!recoveryPollEnabled && retryAttempts === 0) {
      setRecoveryPollEnabled(true);
      return;
    }
    if (!redirectedPayment) return;

    if (redirectedPayment.status === 'succeeded') {
      trackPaymentOutcome(redirectedPayment.id, 'payment_success', { kind: 'subscribe' });
      setActivatedPlan({
        planName: redirectedPayment.planName ?? null,
        planSlug: redirectedPayment.planSlug ?? null,
      });
      setRecoveryPollEnabled(false);
      setRecoveryForId(null);
      void utils.subscription.getBillingState.invalidate();
      // Credit widget + model-lock (🔒) queries must reflect the new plan
      // immediately, not after their 5-minute staleTime.
      void utils.spend.invalidate();
      return;
    }

    if (redirectedPayment.status === 'pending') {
      // Wait up to ~10s for the webhook. After that treat as abandoned
      // and offer recovery — by then YK has either cancelled or the
      // user is back on our page anyway.
      if (retryAttempts >= 7) {
        setRecoveryPollEnabled(false);
        setRecoveryOpen(true);
        // CRITICAL: also drop the URL param. Without this, the next
        // effect-fire sees `recoveryForId` still set + `!recoveryPollEnabled`
        // and hits the "Start polling on first mount" branch above, which
        // re-enables polling and resets retryAttempts to 0 — creating an
        // infinite oscillation (7-increment cycle restarts forever) →
        // React error #185. Clearing the URL param trips the first guard
        // (`if (!recoveryForId) return`) so the effect exits cleanly.
        setRecoveryForId(null);
      } else {
        setRetryAttempts((n) => n + 1);
      }
      return;
    }

    // canceled / failed → recovery flow. Same oscillation guard as above.
    trackPaymentOutcome(redirectedPayment.id, 'payment_failed', {
      kind: 'subscribe',
      status: redirectedPayment.status,
    });
    setRecoveryPollEnabled(false);
    setRecoveryOpen(true);
    setRecoveryForId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    recoveryForId,
    redirectedPayment,
    recoveryPollEnabled,
    retryAttempts,
    message,
    setRecoveryForId,
    // utils intentionally omitted — see comment above.
  ]);

  // Drive the fallback (visited Plans without YK redirect).
  useEffect(() => {
    if (recoveryForId) return; // URL flow takes priority
    if (fallbackAttempt && !recoveryDismissed && !recoveryOpen) {
      setRecoveryOpen(true);
    }
  }, [fallbackAttempt, recoveryDismissed, recoveryOpen, recoveryForId]);

  // Broadcast-campaign deep-link: `/settings/plans?ref=<code>` pre-fills the
  // promo input so the recipient doesn't have to retype it from the email.
  // Also suppresses the recovery modal — `?ref=` means "user clicked a
  // marketing link", not "user returned from a failed checkout".
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (!ref) return;
    if (!promoInput) setPromoInput(ref.toUpperCase());
    setRecoveryDismissed(true);
    setRecoveryOpen(false);
    try {
      sessionStorage.setItem('wgpt:recovery-dismissed', '1');
    } catch {
      // sessionStorage may be unavailable in private mode — non-fatal
    }
    // run-once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recoveryAttempt = recoveryForId ? redirectedPayment : fallbackAttempt;

  const closeRecovery = () => {
    setRecoveryOpen(false);
    setRecoveryDismissed(true);
    if (recoveryForId) setRecoveryForId(null);
    try {
      sessionStorage.setItem('wgpt:recovery-dismissed', '1');
    } catch {
      /* private mode / quota — fine, in-memory flag holds for this session */
    }
  };

  const retryRecoveryPayment = () => {
    if (!recoveryAttempt?.planId) return;
    closeRecovery();
    startSubscribe(recoveryAttempt.planId);
  };

  const handlePromoRedeem = async () => {
    const code = promoInput.trim();
    if (!code) {
      message.warning('Введите промокод');
      return;
    }
    setPromoRedeeming(true);
    try {
      const res = await lambdaClient.promo.redeem.mutate({ code });
      message.success(res.message || 'Промокод применён');
      setPromoInput('');
      closeRecovery();
      await utils.subscription.getBillingState.invalidate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка применения';
      const label =
        msg === 'code_not_found'
          ? 'Промокод не найден'
          : msg === 'code_expired'
            ? 'Промокод истёк'
            : msg === 'code_max_uses_reached'
              ? 'Промокод исчерпан'
              : msg === 'code_already_redeemed'
                ? 'Вы уже использовали этот промокод'
                : msg;
      message.error(label);
    } finally {
      setPromoRedeeming(false);
    }
  };

  // Accept reason/text as args so the mobile bottom-sheet flow doesn't
  // race against state-set timing. Earlier the desktop modal used
  // closure state and the mobile flow tried to setState then await —
  // first submit always sent the previous reason.
  const handleRemoveCard = async () => {
    setRemovingCard(true);
    try {
      await lambdaClient.subscription.removePaymentMethod.mutate();
      message.success('Карта удалена. Авто-продление отключено.');
      setRemoveCardOpen(false);
      await utils.subscription.getBillingState.invalidate();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Не удалось удалить карту');
    } finally {
      setRemovingCard(false);
    }
  };

  const handleCancelSubmit = async (reasonCodeArg?: string, reasonTextArg?: string) => {
    const reasonCode = reasonCodeArg ?? cancelReason;
    const reasonText = (reasonTextArg ?? cancelText).trim() || undefined;
    setCancelling(true);
    try {
      const res = await lambdaClient.subscription.cancelSubscription.mutate({
        reasonCode: reasonCode as any,
        reasonText,
      });
      // ФЗ 376 / ст. 16.1 ЗПП — the refusal must be confirmed in writing and
      // must say that no further money will be taken. The server also sends
      // the same confirmation by email / Telegram (notifySubscriptionCancelled).
      const until = res?.activeUntil
        ? new Date(res.activeUntil).toLocaleDateString('ru-RU')
        : null;
      message.success({
        content: [
          'Автопродление отключено — списаний больше не будет.',
          'Сохранённая карта удалена.',
          until ? `Доступ сохраняется до ${until}.` : null,
        ]
          .filter(Boolean)
          .join(' '),
        duration: 8,
      });
      setCancelOpen(false);
      setCancelText('');
      // Refresh billing state so the banner re-renders with cancelled flag.
      await utils.subscription.getBillingState.invalidate();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Не удалось отменить');
    } finally {
      setCancelling(false);
    }
  };

  const subscribeMutation = lambdaQuery.subscription.createPayment.useMutation({
    onSuccess: (data) => {
      reachGoal('checkout_start', { kind: 'subscribe', source: 'plans_page' });
      if (data.paymentUrl) window.location.href = data.paymentUrl;
    },
  });

  const topUpMutation = lambdaQuery.topUp.createPayment.useMutation({
    onSuccess: (data) => {
      reachGoal('checkout_start', { kind: 'topup', source: 'plans_page' });
      if (data.paymentUrl) window.location.href = data.paymentUrl;
    },
  });

  // Single entry points for both desktop cards, the mobile layout and the
  // recovery-modal retry, so every subscribe/top-up click reaches Metrika.
  const startSubscribe = (planId: number) => {
    const plan = plans?.find((p) => p.id === planId);
    reachGoal('paywall_click', {
      kind: 'subscribe',
      plan: plan?.slug ?? planId,
      source: 'plans_page',
    });
    // ФЗ 376: which surface rendered the consent statement and which wording
    // version it was. The server rebuilds the exact text from the plan price
    // and stores it on the payment row (see buildConsentRecord).
    subscribeMutation.mutate({
      consent: {
        surface: isMobile ? 'plans_mobile' : 'plans_desktop',
        version: RECURRING_CONSENT_VERSION,
      },
      planId,
    });
  };

  const startTopUp = (amountRub: number) => {
    reachGoal('paywall_click', { amountRub, kind: 'topup', source: 'plans_page' });
    topUpMutation.mutate({ amountRub });
  };

  const isLoading = plansLoading || billingLoading;

  if (isLoading) {
    return (
      <>
        <SettingHeader title={t('tab.plans')} />
        <Flexbox align="center" justify="center" style={{ padding: 64 }}>
          <Spin />
        </Flexbox>
      </>
    );
  }

  const currentPlan = billing?.plan;
  const creditLimit = billing?.creditLimit || 0;
  const creditsUsed = billing?.creditsUsed || 0;
  const creditBalance = billing?.creditBalance || 0;
  const totalAvailable = creditLimit + creditBalance;
  const usagePercent = totalAvailable > 0 ? Math.round((creditsUsed / totalAvailable) * 100) : 0;
  const freeQuota = creditState ? freeQuotaOf(creditState) : null;

  // Post-payment success modal, shared by both render branches. Mounted
  // only after a success so its recent-topics fetch doesn't run on every
  // plans visit.
  const activatedModal = activatedPlan ? (
    <SubscriptionActivatedModal
      open
      returnToChat
      planName={activatedPlan.planName}
      planSlug={activatedPlan.planSlug}
      onClose={() => setActivatedPlan(null)}
    />
  ) : null;

  // Recovery modal lifted out of both render branches so mobile + desktop
  // share one source of truth and behaviour.
  const recoveryModal = (
    <Modal
      footer={null}
      open={recoveryOpen}
      title="Не закончили оплату?"
      width={480}
      onCancel={closeRecovery}
    >
      <Flexbox gap={16}>
        <Text type="secondary">
          {recoveryAttempt?.planName
            ? `Прошлая попытка оплатить «${recoveryAttempt.planName}» (${recoveryAttempt.amountRub} ₽) не завершилась. Деньги не списались.`
            : 'Прошлая попытка оплатить подписку не завершилась. Деньги не списались.'}
        </Text>

        <Button
          block
          loading={subscribeMutation.isPending}
          size="large"
          type="primary"
          onClick={retryRecoveryPayment}
        >
          Попробовать оплатить ещё раз
        </Button>

        <Divider plain style={{ marginBlock: 4 }}>
          <Text style={{ fontSize: 12 }} type="secondary">
            или
          </Text>
        </Divider>

        <Flexbox gap={8}>
          <Text strong style={{ fontSize: 13 }}>
            Есть промокод? Введите его
          </Text>
          <Flexbox horizontal gap={8}>
            <Input
              placeholder="PROMO-CODE"
              size="large"
              value={promoInput}
              onChange={(e) => setPromoInput(e.target.value)}
              onPressEnter={handlePromoRedeem}
            />
            <Button loading={promoRedeeming} size="large" onClick={handlePromoRedeem}>
              Применить
            </Button>
          </Flexbox>
          <Text style={{ fontSize: 12 }} type="secondary">
            Промокод даст вам бонусные кредиты или сразу активирует тариф.
          </Text>
        </Flexbox>

        <Divider plain style={{ marginBlock: 4 }} />

        <Flexbox gap={8}>
          <Text strong style={{ fontSize: 13 }}>
            Не получается оплатить?
          </Text>
          <Text style={{ fontSize: 12 }} type="secondary">
            Часто карты российских банков не принимают повторные списания — попробуйте другую карту
            или напишите в поддержку, поможем разобраться.
          </Text>
          <Button block href="https://t.me/gptwebrubot" size="large" target="_blank" type="default">
            Связаться с поддержкой в Telegram
          </Button>
        </Flexbox>
      </Flexbox>
    </Modal>
  );

  if (isMobile && plans && billing) {
    // Mobile: vertical-stack layout + bottom-sheet cancel flow. Active
    // paid users see a "Отменить подписку" button below the plan list.
    const isActivePaid = currentPlan != null && currentPlan.priceRub > 0 && !billing?.cancelledAt;

    return (
      <>
        <SettingHeader title={t('tab.plans')} />
        <IntroOfferBanner />
        <PlansMobileLayout
          features={PLAN_FEATURES}
          freeQuota={freeQuota}
          subscribePending={subscribeMutation.isPending}
          topUpPending={topUpMutation.isPending}
          billing={{
            creditBalance,
            creditLimit,
            creditsUsed,
            subscriptionExpiresAt:
              billing?.subscriptionExpiresAt instanceof Date
                ? billing.subscriptionExpiresAt.toISOString()
                : billing?.subscriptionExpiresAt,
          }}
          currentPlan={
            currentPlan
              ? {
                  name: currentPlan.name,
                  priceRub: currentPlan.priceRub,
                  slug: currentPlan.slug,
                }
              : null
          }
          packages={packages?.map((p) => ({
            amountRub: p.amountRub,
            label: p.label,
          }))}
          plans={plans.map((p) => ({
            id: p.id,
            name: p.name,
            priceRub: p.priceRub,
            slug: p.slug,
            tokenLimit: p.tokenLimit,
          }))}
          onSelect={startSubscribe}
          onTopUp={startTopUp}
        />
        {isActivePaid && (
          <div style={{ paddingBlock: 8, paddingInline: 16 }}>
            <Button block danger onClick={() => setCancelOpen(true)}>
              Отменить подписку
            </Button>
          </div>
        )}
        <MobileCancelFlow
          loading={cancelling}
          open={cancelOpen}
          onClose={() => setCancelOpen(false)}
          onConfirm={async (reasonCode, reasonText) => {
            // Pass reason directly; setState updates would not flush
            // before `handleCancelSubmit` reads from closure scope.
            setCancelReason(reasonCode);
            setCancelText(reasonText);
            await handleCancelSubmit(reasonCode, reasonText);
          }}
        />
        {recoveryModal}
        {activatedModal}
      </>
    );
  }

  return (
    <>
      <SettingHeader title={t('tab.plans')} />

      <IntroOfferBanner />

      {/* Current usage */}
      <Card style={{ marginTop: 16 }}>
        <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 12 }}>
          <Title level={5} style={{ margin: 0 }}>
            {currentPlan?.name || 'Старт'}
            {currentPlan && currentPlan.priceRub > 0 && (
              <Tag color="blue" style={{ marginLeft: 8 }}>
                {currentPlan.priceRub} ₽/мес
              </Tag>
            )}
          </Title>
          {billing?.subscriptionExpiresAt && (
            <Text type="secondary">
              до {new Date(billing.subscriptionExpiresAt).toLocaleDateString('ru-RU')}
            </Text>
          )}
        </Flexbox>
        {freeQuota ? (
          <FreeQuotaSummary {...freeQuota} />
        ) : (
          <>
            <Progress
              format={() => `${creditsUsed} / ${totalAvailable} кредитов`}
              percent={Math.min(usagePercent, 100)}
              strokeColor={
                usagePercent > 90 ? '#ff4d4f' : usagePercent > 70 ? '#faad14' : undefined
              }
            />
            <Text style={{ marginTop: 4 }} type="secondary">
              План: {creditLimit} кредитов | Пополнения: {creditBalance} кредитов
            </Text>
          </>
        )}

        {currentPlan && currentPlan.priceRub > 0 && (
          <>
            <Divider style={{ margin: '12px 0' }} />
            {billing?.cancelledAt ? (
              <Flexbox horizontal align="center" gap={12} justify="space-between">
                <Text type="warning">
                  Подписка отменена — списаний больше не будет, сохранённая карта удалена. Доступ
                  сохраняется до{' '}
                  {billing.subscriptionExpiresAt
                    ? new Date(billing.subscriptionExpiresAt).toLocaleDateString('ru-RU')
                    : '—'}
                  . После этой даты — план «Старт».
                </Text>
              </Flexbox>
            ) : billing?.autoRenew && billing.hasSavedPaymentMethod ? (
              <Flexbox horizontal align="center" gap={12} justify="space-between">
                <Text type="secondary">
                  Подписка продлевается автоматически. Списание {currentPlan.priceRub} ₽ каждый
                  месяц до отмены.
                </Text>
                <Button danger size="small" onClick={() => setCancelOpen(true)}>
                  Отменить подписку
                </Button>
              </Flexbox>
            ) : (
              <Flexbox horizontal align="center" gap={12} justify="space-between">
                <Text type="secondary">
                  Авто-продление не настроено — подписка истечёт по окончании периода.
                </Text>
                <Button danger size="small" onClick={() => setCancelOpen(true)}>
                  Отменить подписку
                </Button>
              </Flexbox>
            )}

            {billing?.hasSavedPaymentMethod && (
              <>
                <Divider style={{ margin: '12px 0' }} />
                <Flexbox horizontal align="center" gap={12} justify="space-between">
                  <Text type="secondary">
                    Карта сохранена для автосписания. Можно удалить — текущая подписка останется
                    активной до конца оплаченного периода.
                  </Text>
                  <Button danger size="small" onClick={() => setRemoveCardOpen(true)}>
                    Удалить карту
                  </Button>
                </Flexbox>
              </>
            )}
          </>
        )}
      </Card>

      <Modal
        cancelText="Отмена"
        confirmLoading={removingCard}
        okButtonProps={{ danger: true }}
        okText="Удалить карту"
        open={removeCardOpen}
        title="Удалить сохранённую карту?"
        width={460}
        onCancel={() => setRemoveCardOpen(false)}
        onOk={handleRemoveCard}
      >
        <Text type="secondary">
          Авто-продление подписки будет отключено. Доступ к платным функциям сохранится до конца
          оплаченного периода. Чтобы продолжить пользоваться платным тарифом после этой даты,
          понадобится оплатить заново.
        </Text>
      </Modal>

      {recoveryModal}
      {activatedModal}

      <Modal
        cancelText="Передумал"
        confirmLoading={cancelling}
        okButtonProps={{ danger: true }}
        okText="Отменить подписку"
        open={cancelOpen}
        title="Отменить подписку?"
        width={460}
        onCancel={() => setCancelOpen(false)}
        onOk={() => handleCancelSubmit()}
      >
        <Text type="secondary">
          Автопродление будет отключено, сохранённая карта — удалена, списаний больше не будет.
          Доступ к платным функциям сохранится до{' '}
          {billing?.subscriptionExpiresAt
            ? new Date(billing.subscriptionExpiresAt).toLocaleDateString('ru-RU')
            : '—'}
          . После этой даты вы вернётесь на тариф «Старт». Расскажите, почему уходите — это поможет
          нам стать лучше:
        </Text>
        <Radio.Group
          style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
        >
          {CANCEL_REASONS.map((r) => (
            <Radio key={r.code} value={r.code}>
              {r.label}
            </Radio>
          ))}
        </Radio.Group>
        {cancelReason === 'other' && (
          <Input.TextArea
            maxLength={500}
            placeholder="Расскажите подробнее (необязательно)"
            rows={3}
            style={{ marginTop: 12 }}
            value={cancelText}
            onChange={(e) => setCancelText(e.target.value)}
          />
        )}
      </Modal>

      {/* Plan comparison */}
      <Title level={5} style={{ marginBottom: 0, marginTop: 24 }}>
        Выберите подходящий план
      </Title>
      <Grid gap={16} maxItemWidth={220} rows={3} style={{ marginTop: 12 }}>
        {plans?.map((plan) => {
          const isCurrent = currentPlan?.id === plan.id;
          const isPopular = plan.slug === 'basic';
          const features = PLAN_FEATURES[plan.slug] || PLAN_FEATURES.free;
          const hint = MESSAGES_HINT[plan.slug] || '';

          return (
            <Card
              key={plan.id}
              size="small"
              style={{
                border: isCurrent
                  ? '2px solid #52c41a'
                  : isPopular
                    ? '2px solid #1677ff'
                    : undefined,
                position: 'relative',
              }}
            >
              {isPopular && !isCurrent && (
                <Tag
                  color="blue"
                  style={{
                    left: '50%',
                    position: 'absolute',
                    top: -12,
                    transform: 'translateX(-50%)',
                  }}
                >
                  {t('plans.popular')}
                </Tag>
              )}
              <Flexbox align="center" gap={8} style={{ paddingTop: isPopular ? 8 : 0 }}>
                <Title level={5} style={{ margin: 0 }}>
                  {plan.name}
                </Title>
                <Text style={{ fontSize: 24, fontWeight: 600 }}>
                  {plan.priceRub === 0 ? t('plans.free') : `${plan.priceRub} ₽`}
                </Text>
                {plan.priceRub > 0 && (
                  <Text style={{ marginTop: -6 }} type="secondary">
                    в месяц
                  </Text>
                )}
                <Divider style={{ margin: '4px 0' }} />
                {plan.priceRub === 0 ? (
                  <Text strong>
                    {t('freeQuota.planCard', { quota: FREE_DAILY_MESSAGE_QUOTA_HINT })}
                  </Text>
                ) : (
                  <>
                    <Text strong>{plan.tokenLimit} кредитов/мес</Text>
                    <Text style={{ fontSize: 12, marginTop: -2 }} type="secondary">
                      ≈ {creditsToHuman(plan.tokenLimit).answers} ответов или{' '}
                      {creditsToHuman(plan.tokenLimit).images} картинок
                    </Text>
                  </>
                )}
                {hint && (
                  <Text style={{ fontSize: 12 }} type="secondary">
                    {hint}
                  </Text>
                )}
                <Flexbox gap={4} style={{ marginTop: 4, width: '100%' }}>
                  {features.map((featureKey) => (
                    <Flexbox horizontal align="center" gap={6} key={featureKey}>
                      <Check size={14} style={{ color: '#52c41a', flexShrink: 0 }} />
                      <Text style={{ fontSize: 12 }}>{t(featureKey as any)}</Text>
                    </Flexbox>
                  ))}
                </Flexbox>
                <div style={{ marginTop: 8, width: '100%' }}>
                  {isCurrent ? (
                    <Button block disabled>
                      {t('plans.current')}
                    </Button>
                  ) : plan.priceRub > 0 ? (
                    <>
                      <Button
                        block
                        loading={subscribeMutation.isPending}
                        type={isPopular ? 'primary' : 'default'}
                        onClick={() => startSubscribe(plan.id)}
                      >
                        {RECURRING_PAY_LABEL}
                      </Button>
                      {/* ФЗ 376 / ст. 16.1 ЗПП — consent tied to the action,
                          not a decorative disclosure. The text quotes the
                          button label verbatim; `startSubscribe` sends the
                          surface + version so the consent is persisted on the
                          payment row. */}
                      <Text
                        style={{ display: 'block', fontSize: 11, marginTop: 6 }}
                        type="secondary"
                      >
                        {recurringConsentText(plan.priceRub)}
                      </Text>
                    </>
                  ) : null}
                </div>
              </Flexbox>
            </Card>
          );
        })}
      </Grid>

      <PaymentTrustBadges variant="subscription" />

      {/* Top up */}
      {packages && packages.length > 0 && (
        <>
          <Title level={5} style={{ marginBottom: 0, marginTop: 24 }}>
            {t('funds.topUp.title')}
          </Title>
          <Grid gap={16} maxItemWidth={200} rows={3} style={{ marginTop: 12 }}>
            {packages.map((pkg) => (
              <Card key={pkg.amountRub} size="small">
                <Flexbox align="center" gap={8}>
                  <Title level={5} style={{ margin: 0 }}>
                    {pkg.label}
                  </Title>
                  <Text style={{ fontSize: 20 }}>{pkg.amountRub} ₽</Text>
                  <Button
                    block
                    loading={topUpMutation.isPending}
                    onClick={() => startTopUp(pkg.amountRub)}
                  >
                    {t('funds.topUp.purchaseNow')}
                  </Button>
                </Flexbox>
              </Card>
            ))}
          </Grid>
        </>
      )}

      {/* Promo redeem — always visible at the bottom of /settings/plans.
          Broadcast recipients click "Open" in the email and land here with
          `?ref=<code>`; we pre-fill the field so they don't have to hunt. */}
      <Card size="small" style={{ marginTop: 24 }}>
        <Flexbox gap={8}>
          <Title level={5} style={{ margin: 0 }}>
            Есть промокод? Введите его
          </Title>
          <Flexbox horizontal gap={8}>
            <Input
              placeholder="PROMO-CODE"
              size="large"
              value={promoInput}
              onChange={(e) => setPromoInput(e.target.value)}
              onPressEnter={handlePromoRedeem}
            />
            <Button loading={promoRedeeming} size="large" onClick={handlePromoRedeem}>
              Применить
            </Button>
          </Flexbox>
          <Text style={{ fontSize: 12 }} type="secondary">
            Бонусные кредиты или активация тарифа. Код из email-рассылки активируется только после
            оплаты любого тарифа в течение 24 часов.
          </Text>
        </Flexbox>
      </Card>
    </>
  );
});

Plans.displayName = 'Plans';
export default Plans;
