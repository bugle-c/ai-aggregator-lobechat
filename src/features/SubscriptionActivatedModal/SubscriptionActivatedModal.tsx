'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Modal, Tag, Typography } from 'antd';
import { Check, Sparkles } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { getRecommendedModels } from '@/const/recommended-models';
import { findEnabledModel } from '@/features/Generators/presetModelSwitch';
import { prettifyModelId } from '@/features/Generators/prettifyModelId';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { useInitRecentTopic } from '@/hooks/useInitRecentTopic';
import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';
import { homeRecentSelectors } from '@/store/home/selectors';

const { Text, Title } = Typography;

const TIER_KEYS: Record<string, string> = {
  basic: 'activated.tier.basic',
  free: 'activated.tier.free',
  pro: 'activated.tier.pro',
  pro_max: 'activated.tier.pro_max',
};

export interface SubscriptionActivatedModalProps {
  /**
   * Agent whose model the primary CTA switches. When omitted (plans page)
   * the most recent topic's agent is used.
   */
  agentId?: string | null;
  onClose: () => void;
  open: boolean;
  /** Display name from billing_plans; falls back to the slug. */
  planName?: string | null;
  planSlug?: string | null;
  /**
   * Plans-page mode: after either choice, navigate back to the most
   * recent topic (or `/`) so the user lands in a chat, not on a settings
   * page with nothing to do.
   */
  returnToChat?: boolean;
}

/**
 * Fix 2 — tell the payer what they just got. Lists the plan-aware
 * recommended models and offers a one-click switch to the best of them.
 * No model change happens without a click.
 */
const SubscriptionActivatedModal = memo<SubscriptionActivatedModalProps>(
  ({ agentId, onClose, open, planName, planSlug, returnToChat }) => {
    const { t } = useTranslation('subscription');
    const navigate = useNavigate();
    const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);
    const enabled = useEnabledChatModels();

    // Plans page has no active agent: fall back to the latest topic's agent
    // and use the same row as the "back to chat" target.
    useInitRecentTopic();
    const recentTopics = useHomeStore(homeRecentSelectors.recentTopics);
    const latestTopic = recentTopics[0];

    const recommended = useMemo(() => getRecommendedModels(planSlug), [planSlug]);

    // Best recommended model the user can actually pick right now, with the
    // provider resolved from the enabled list (never assumed). Until that
    // list has loaded there is no target and the switch CTA stays hidden.
    const target = useMemo(() => {
      if (enabled.length === 0) return null;
      const sorted = [...recommended].sort((a, b) => a.order - b.order);
      for (const m of sorted) {
        const found = findEnabledModel(enabled, m.modelId);
        if (found) return found;
      }
      return null;
    }, [enabled, recommended]);

    const targetAgentId =
      agentId ?? (latestTopic?.type === 'agent' ? latestTopic.agent?.id : null) ?? null;

    const backPath = latestTopic
      ? latestTopic.type === 'group' && latestTopic.group?.id
        ? `/group/${latestTopic.group.id}?topic=${latestTopic.id}`
        : latestTopic.type === 'agent' && latestTopic.agent?.id
          ? `/agent/${latestTopic.agent.id}?topic=${latestTopic.id}`
          : '/'
      : '/';

    const finish = () => {
      onClose();
      if (returnToChat) navigate(backPath);
    };

    const handleContinueWith = () => {
      if (target && targetAgentId) {
        void updateAgentConfigById(targetAgentId, {
          model: target.modelId,
          provider: target.providerId,
        });
      }
      finish();
    };

    const plan = planName || planSlug || '';
    const tierKey = TIER_KEYS[planSlug ?? ''];

    return (
      <Modal
        centered
        footer={null}
        open={open}
        width={480}
        title={
          <Flexbox horizontal align="center" gap={8}>
            <Icon icon={Sparkles} />
            {t('activated.title', { plan })}
          </Flexbox>
        }
        onCancel={finish}
      >
        <Flexbox gap={16}>
          <Flexbox gap={4}>
            <Title level={5} style={{ margin: 0 }}>
              {t('activated.desc')}
            </Title>
            {tierKey && <Text type="secondary">{t(tierKey as any)}</Text>}
          </Flexbox>

          <Flexbox gap={8}>
            {recommended.map((m) => {
              const found = enabled.length > 0 ? findEnabledModel(enabled, m.modelId) : null;
              const name = found?.displayName ?? prettifyModelId(m.modelId);
              return (
                <Flexbox horizontal align="center" gap={8} key={m.modelId}>
                  <Check size={16} style={{ color: '#52c41a', flexShrink: 0 }} />
                  <Flexbox gap={0} style={{ flex: 1, minWidth: 0 }}>
                    <Text strong>{name}</Text>
                    <Text style={{ fontSize: 12 }} type="secondary">
                      {m.description}
                    </Text>
                  </Flexbox>
                  <Tag style={{ margin: 0 }}>{t('activated.cost', { cost: m.creditCost })}</Tag>
                </Flexbox>
              );
            })}
          </Flexbox>

          <Flexbox gap={8}>
            {target && targetAgentId ? (
              <Button block size="large" type="primary" onClick={handleContinueWith}>
                {t('activated.continueWith', { model: target.displayName })}
              </Button>
            ) : (
              <Button block size="large" type="primary" onClick={finish}>
                {t('activated.continue')}
              </Button>
            )}
            <Button block onClick={finish}>
              {t('activated.keepModel')}
            </Button>
          </Flexbox>
        </Flexbox>
      </Modal>
    );
  },
);

SubscriptionActivatedModal.displayName = 'SubscriptionActivatedModal';

export default SubscriptionActivatedModal;
