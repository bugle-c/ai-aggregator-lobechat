'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Card, Modal, Tag, Typography } from 'antd';
import { Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { reachGoal } from '@/business/client/analytics/ym';
import { type CreditsExhaustedReason } from '@/business/client/creditsExhausted';
import IntroOfferBanner from '@/business/client/IntroOffer/IntroOfferBanner';
import { lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

const { Text, Title } = Typography;

interface CreditsExhaustedModalProps {
  /**
   * Contextual reassurance line rendered under the title, e.g. «Ваш диалог
   * сохранён — после оплаты вы вернётесь ровно сюда».
   */
  contextNote?: string;
  /** Free-plan daily message quota the server refused with (EXP-003). */
  dailyQuota?: number;
  onClose: () => void;
  open: boolean;
  /**
   * Why the request was refused (server `reason`). `daily_quota` switches
   * the copy to «Лимит на сегодня исчерпан» and the CTA row to
   * upgrade / top-up / wait-until-tomorrow. Defaults to `credits`.
   */
  reason?: CreditsExhaustedReason;
  /**
   * In-app path (/agent/... or /home...) YooKassa should return the payer
   * to instead of the default settings pages. Passed through to both
   * createPayment mutations.
   */
  returnPath?: string;
}

const CreditsExhaustedModal = memo<CreditsExhaustedModalProps>(
  ({ open, onClose, contextNote, dailyQuota = 5, reason = 'credits', returnPath }) => {
    const { t } = useTranslation('subscription');
    const isLogin = useUserStore(authSelectors.isLogin);
    const router = useRouter();

    const { data } = lambdaQuery.spend.getCreditState.useQuery(undefined, {
      enabled: isLogin,
    });
    const { data: plans } = lambdaQuery.subscription.getPlans.useQuery();
    const { data: packages } = lambdaQuery.topUp.getPackages.useQuery();

    const subscribeMutation = lambdaQuery.subscription.createPayment.useMutation({
      onSuccess: (d) => {
        // Payment created, redirecting to checkout.
        reachGoal('checkout_start', { kind: 'subscribe', source: 'credits_exhausted' });
        if (d.paymentUrl) window.location.href = d.paymentUrl;
      },
    });

    const topUpMutation = lambdaQuery.topUp.createPayment.useMutation({
      onSuccess: (d) => {
        // Payment created, redirecting to checkout.
        reachGoal('checkout_start', { kind: 'topup', source: 'credits_exhausted' });
        if (d.paymentUrl) window.location.href = d.paymentUrl;
      },
    });

    if (!data || !plans) return null;

    const { planName, planSlug, daysUntilReset, creditLimit } = data;
    const upgradePlans = plans.filter((p) => p.priceRub > 0);
    const cheapestTopup = packages?.[0];

    // Recommended = next tier above the user's current plan. Users on free →
    // recommend basic; on basic → recommend pro. If no "next", first priced
    // plan is recommended (usually basic).
    const planOrder = ['free', 'basic', 'pro', 'pro_max'];
    const currentIdx = planOrder.indexOf(planSlug || 'free');
    const recommendedSlug = planOrder[currentIdx + 1] || 'basic';
    const recommendedPlan =
      upgradePlans.find((p) => p.slug === recommendedSlug) ?? upgradePlans[0];
    const recommendedId = recommendedPlan?.id;

    // "X× больше" — visual anchor for how much more value the upgrade gives.
    const formatMultiplier = (planCredits: number): string => {
      if (!creditLimit || creditLimit <= 0) return '';
      const ratio = Math.round(planCredits / creditLimit);
      return ratio > 1 ? `×${ratio} больше` : '';
    };

    // EXP-003: free daily quota spent — the user is not «out of credits»,
    // tomorrow refills for free. Lead with the one plan that removes the
    // daily limit, keep top-up, and offer an honest «wait» exit.
    const isDaily = reason === 'daily_quota';

    const subscribeTo = (plan: { id: number; slug: string }) => {
      reachGoal('paywall_click', {
        kind: 'subscribe',
        plan: plan.slug,
        reason,
        source: 'credits_exhausted',
      });
      subscribeMutation.mutate({ planId: plan.id, returnPath });
    };

    return (
      <Modal
        centered
        footer={null}
        open={open}
        width={540}
        title={
          <Flexbox horizontal align="center" gap={8}>
            <Icon icon={Zap} />
            {t(isDaily ? 'modal.exhausted.daily.title' : 'modal.exhausted.title')}
          </Flexbox>
        }
        onCancel={onClose}
      >
        <Flexbox gap={16}>
          {contextNote && <Text type="secondary">{contextNote}</Text>}
          {isDaily ? (
            <Text>{t('modal.exhausted.daily.desc', { quota: dailyQuota })}</Text>
          ) : (
            <>
              <Text>{t('modal.exhausted.desc', { credits: creditLimit, plan: planName })}</Text>
              <Text type="secondary">
                {t('modal.exhausted.resetIn', { days: daysUntilReset })} · без доступа до сброса
              </Text>
            </>
          )}

          <IntroOfferBanner />

          {isDaily && recommendedPlan && (
            <Button
              block
              loading={subscribeMutation.isPending}
              type="primary"
              onClick={() => subscribeTo(recommendedPlan)}
            >
              {t('modal.exhausted.daily.upgrade', {
                plan: recommendedPlan.name,
                price: recommendedPlan.priceRub,
              })}
            </Button>
          )}

          <Flexbox horizontal gap={12} style={isDaily ? { display: 'none' } : undefined}>
            {upgradePlans.map((plan) => {
              const isRecommended = plan.id === recommendedId;
              const multiplier = formatMultiplier(plan.tokenLimit);
              return (
                <Card
                  key={plan.id}
                  size="small"
                  style={{
                    borderColor: isRecommended ? '#1677ff' : undefined,
                    borderWidth: isRecommended ? 2 : 1,
                    flex: 1,
                    position: 'relative',
                    textAlign: 'center',
                  }}
                >
                  {isRecommended && (
                    <Tag
                      color="blue"
                      style={{
                        left: '50%',
                        position: 'absolute',
                        top: -10,
                        transform: 'translateX(-50%)',
                      }}
                    >
                      Рекомендуем
                    </Tag>
                  )}
                  <Flexbox align="center" gap={6}>
                    <Title level={5} style={{ margin: 0 }}>
                      {plan.name}
                    </Title>
                    <Text style={{ fontSize: 20, fontWeight: 600 }}>{plan.priceRub} ₽/мес</Text>
                    <Text type="secondary">{plan.tokenLimit.toLocaleString('ru-RU')} кредитов</Text>
                    {multiplier && (
                      <Tag color={isRecommended ? 'blue' : 'default'} style={{ margin: 0 }}>
                        {multiplier}
                      </Tag>
                    )}
                    <Button
                      block
                      loading={subscribeMutation.isPending}
                      type={isRecommended ? 'primary' : 'default'}
                      // returnPath sends the payer back to this exact chat;
                      // the global PaymentReturnHandler picks up `recoveryFor`
                      // there (success modal / hand-off to the plans recovery).
                      onClick={() => subscribeTo(plan)}
                    >
                      {isRecommended ? 'Продолжить общение' : t('modal.exhausted.select')}
                    </Button>
                  </Flexbox>
                </Card>
              );
            })}
          </Flexbox>

          {cheapestTopup && (
            <Button
              block
              loading={topUpMutation.isPending}
              type="dashed"
              onClick={() => {
                reachGoal('paywall_click', { kind: 'topup', reason, source: 'credits_exhausted' });
                topUpMutation.mutate({ amountRub: cheapestTopup.amountRub, returnPath });
              }}
            >
              {isDaily
                ? t('modal.exhausted.topup', { price: cheapestTopup.amountRub })
                : `Или разово докупить за ${cheapestTopup.amountRub} ₽`}
            </Button>
          )}

          {isDaily && (
            <Button block type="default" onClick={onClose}>
              {t('modal.exhausted.daily.wait')}
            </Button>
          )}

          <Button
            block
            type="default"
            onClick={() => {
              router.push('/settings/referral');
              onClose();
            }}
          >
            🎁 Пригласить друга — +100 кр
          </Button>
        </Flexbox>
      </Modal>
    );
  },
);

CreditsExhaustedModal.displayName = 'CreditsExhaustedModal';
export default CreditsExhaustedModal;
