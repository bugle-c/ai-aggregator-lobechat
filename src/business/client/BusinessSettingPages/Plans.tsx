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
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingHeader from '@/app/[variants]/(main)/settings/features/SettingHeader';
import MobileCancelFlow from '@/features/Upsell/MobileCancelFlow';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useQueryState } from '@/hooks/useQueryParam';
import { lambdaClient, lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

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

// Approximate messages per credit (1 credit ≈ 1 message)
const MESSAGES_HINT: Record<string, string> = {
  basic: '~33 сообщений/день',
  free: '~50 сообщений',
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

  // IMPORTANT: keep all hooks above any early-return.
  // useIsMobile() wraps antd-style useResponsive() which calls useRef
  // internally. Calling it after a conditional return causes React #310
  // ("Rendered more hooks than during the previous render") when the
  // loading branch resolves and the component re-renders with one
  // additional hook in scope.
  const isMobile = useIsMobile();
  const isLogin = useUserStore(authSelectors.isLogin);

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
    if (!recoveryPollEnabled) {
      setRecoveryPollEnabled(true);
      setRetryAttempts(0);
      return;
    }
    if (!redirectedPayment) return;

    if (redirectedPayment.status === 'succeeded') {
      message.success(`Подписка «${redirectedPayment.planName ?? ''}» активирована. Спасибо!`, 4);
      setRecoveryPollEnabled(false);
      setRecoveryForId(null);
      void utils.subscription.getBillingState.invalidate();
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
    subscribeMutation.mutate({ planId: recoveryAttempt.planId });
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
      await lambdaClient.subscription.cancelSubscription.mutate({
        reasonCode: reasonCode as any,
        reasonText,
      });
      message.success('Подписка будет активна до окончания оплаченного периода');
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
      if (data.paymentUrl) window.location.href = data.paymentUrl;
    },
  });

  const topUpMutation = lambdaQuery.topUp.createPayment.useMutation({
    onSuccess: (data) => {
      if (data.paymentUrl) window.location.href = data.paymentUrl;
    },
  });

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
        <PlansMobileLayout
          features={PLAN_FEATURES}
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
          onSelect={(planId) => subscribeMutation.mutate({ planId })}
          onTopUp={(amountRub) => topUpMutation.mutate({ amountRub })}
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
      </>
    );
  }

  return (
    <>
      <SettingHeader title={t('tab.plans')} />

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
        <Progress
          format={() => `${creditsUsed} / ${totalAvailable} кредитов`}
          percent={Math.min(usagePercent, 100)}
          strokeColor={usagePercent > 90 ? '#ff4d4f' : usagePercent > 70 ? '#faad14' : undefined}
        />
        <Text style={{ marginTop: 4 }} type="secondary">
          План: {creditLimit} кредитов | Пополнения: {creditBalance} кредитов
        </Text>

        {currentPlan && currentPlan.priceRub > 0 && (
          <>
            <Divider style={{ margin: '12px 0' }} />
            {billing?.cancelledAt ? (
              <Flexbox horizontal align="center" gap={12} justify="space-between">
                <Text type="warning">
                  Подписка отменена. Доступ сохраняется до{' '}
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
                <Text strong>{plan.tokenLimit} кредитов/мес</Text>
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
                    <Button
                      block
                      loading={subscribeMutation.isPending}
                      type={isPopular ? 'primary' : 'default'}
                      onClick={() => subscribeMutation.mutate({ planId: plan.id })}
                    >
                      {t('plans.subscribe')}
                    </Button>
                  ) : null}
                </div>
              </Flexbox>
            </Card>
          );
        })}
      </Grid>

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
                    onClick={() => topUpMutation.mutate({ amountRub: pkg.amountRub })}
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
