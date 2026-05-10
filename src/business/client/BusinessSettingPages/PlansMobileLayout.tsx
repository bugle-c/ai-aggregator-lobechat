'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Button, Progress, Tag, Typography } from 'antd';
import { Check } from 'lucide-react';
import { memo } from 'react';

const { Text, Title } = Typography;

interface Plan {
  id: number;
  name: string;
  priceRub: number;
  slug: string;
  tokenLimit: number;
}

interface CurrentPlan {
  name: string;
  priceRub: number;
  slug: string;
}

interface Billing {
  creditBalance: number;
  creditLimit: number;
  creditsUsed: number;
  subscriptionExpiresAt?: string | null;
}

interface TopUpPackage {
  amountRub: number;
  label: string;
}

interface Props {
  billing: Billing;
  currentPlan?: CurrentPlan | null;
  /** Codes/labels per plan slug — caller passes their localized list. */
  features?: Record<string, string[]>;
  /** ID of the slug we want to highlight as the recommended plan. */
  highlightedSlug?: string;
  loading?: boolean;
  onSelect: (planId: number) => void;
  onTopUp?: (amountRub: number) => void;
  /** Optional top-up packages — appear below plans as a "Пополнить" stack. */
  packages?: TopUpPackage[];
  plans: Plan[];
  subscribePending?: boolean;
  topUpPending?: boolean;
}

const formatDate = (d: string) => new Date(d).toLocaleDateString('ru-RU');

/**
 * Mobile-friendly plans page used when `useIsMobile()` is true.
 *
 * Replaces the desktop {@link Plans} grid layout with a vertical stack:
 *   1. Current usage card (plan name, expiry, used/limit progress)
 *   2. One vertical card per plan, with the highlightedSlug visually
 *      called out
 *
 * Extracted so the desktop renderer in `Plans.tsx` stays untouched and
 * any mobile cosmetic changes don't drag in desktop regression risk.
 */
const PlansMobileLayout = memo<Props>(
  ({
    billing,
    currentPlan,
    features = {},
    highlightedSlug = 'pro',
    loading,
    plans,
    packages,
    subscribePending,
    topUpPending,
    onSelect,
    onTopUp,
  }) => {
    const totalAvailable = billing.creditLimit + billing.creditBalance;
    const usagePercent =
      totalAvailable > 0 ? Math.round((billing.creditsUsed / totalAvailable) * 100) : 0;

    return (
      <Flexbox gap={16} paddingBlock={16} paddingInline={16}>
        <Block padding={16} variant="filled">
          <Flexbox horizontal justify="space-between">
            <Title level={5} style={{ margin: 0 }}>
              {currentPlan?.name || 'Старт'}
              {currentPlan && currentPlan.priceRub > 0 && (
                <Tag color="blue" style={{ marginInlineStart: 8 }}>
                  {currentPlan.priceRub} ₽/мес
                </Tag>
              )}
            </Title>
            {billing.subscriptionExpiresAt && (
              <Text type="secondary">до {formatDate(billing.subscriptionExpiresAt)}</Text>
            )}
          </Flexbox>
          <Progress
            format={() => `${billing.creditsUsed} / ${totalAvailable} кредитов`}
            percent={Math.min(usagePercent, 100)}
            strokeColor={usagePercent > 90 ? '#ff4d4f' : usagePercent > 70 ? '#faad14' : undefined}
          />
          <Text style={{ marginTop: 4 }} type="secondary">
            План: {billing.creditLimit} кредитов | Пополнения: {billing.creditBalance} кредитов
          </Text>
        </Block>

        {plans.map((plan) => {
          const isCurrent = currentPlan?.slug === plan.slug;
          const isHighlighted = plan.slug === highlightedSlug;
          const planFeatures = features[plan.slug] ?? [];

          return (
            <Block
              key={plan.id}
              padding={16}
              variant="outlined"
              style={{
                borderColor: isHighlighted ? 'var(--ant-color-primary)' : undefined,
                borderWidth: isHighlighted ? 2 : undefined,
              }}
            >
              <Flexbox horizontal align="center" justify="space-between">
                <Title level={5} style={{ margin: 0 }}>
                  {plan.name}
                </Title>
                {isHighlighted && !isCurrent && <Tag color="blue">🔥 Рекомендуем</Tag>}
                {isCurrent && <Tag color="green">Текущий</Tag>}
              </Flexbox>

              <Title level={2} style={{ marginBlock: 8 }}>
                {plan.priceRub === 0 ? 'Бесплатно' : `${plan.priceRub} ₽`}
                {plan.priceRub > 0 && (
                  <Text style={{ fontSize: 14, fontWeight: 'normal' }} type="secondary">
                    {' '}
                    /мес
                  </Text>
                )}
              </Title>

              <Text strong>{plan.tokenLimit} кредитов в месяц</Text>

              <Flexbox gap={6} paddingBlock={12}>
                {planFeatures.map((featureKey) => (
                  <Flexbox horizontal align="center" gap={6} key={featureKey}>
                    <Check size={14} style={{ color: '#52c41a', flexShrink: 0 }} />
                    <Text style={{ fontSize: 13 }}>{featureKey}</Text>
                  </Flexbox>
                ))}
              </Flexbox>

              <Button
                block
                disabled={isCurrent || plan.priceRub === 0}
                loading={subscribePending || loading}
                size="large"
                type={isHighlighted && !isCurrent ? 'primary' : 'default'}
                onClick={() => onSelect(plan.id)}
              >
                {isCurrent ? 'Текущий тариф' : plan.priceRub === 0 ? 'Бесплатно' : 'Выбрать'}
              </Button>
            </Block>
          );
        })}

        {packages && packages.length > 0 && onTopUp && (
          <>
            <Title level={5} style={{ marginBlockEnd: 0, marginBlockStart: 8 }}>
              Пополнить кредиты
            </Title>
            <Text style={{ marginBlockEnd: 4 }} type="secondary">
              Разовое пополнение баланса — не подписка. Кредиты не сгорают.
            </Text>
            {packages.map((pkg) => (
              <Block key={pkg.amountRub} padding={16} variant="filled">
                <Flexbox horizontal align="center" justify="space-between">
                  <Flexbox>
                    <Text strong>{pkg.label}</Text>
                    <Text style={{ fontSize: 13 }} type="secondary">
                      {pkg.amountRub} ₽
                    </Text>
                  </Flexbox>
                  <Button
                    loading={topUpPending}
                    size="middle"
                    onClick={() => onTopUp(pkg.amountRub)}
                  >
                    Купить
                  </Button>
                </Flexbox>
              </Block>
            ))}
          </>
        )}
      </Flexbox>
    );
  },
);

PlansMobileLayout.displayName = 'PlansMobileLayout';

export default PlansMobileLayout;
