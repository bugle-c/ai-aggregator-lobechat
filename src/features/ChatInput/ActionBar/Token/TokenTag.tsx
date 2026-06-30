import { ToolNameResolver } from '@lobechat/context-engine';
import { pluginPrompts } from '@lobechat/prompts';
import { Center, Flexbox, Tooltip } from '@lobehub/ui';
import { TokenTag } from '@lobehub/ui/chat';
import { cssVar } from 'antd-style';
import numeral from 'numeral';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { createAgentToolsEngine } from '@/helpers/toolEngineering';
import { useModelContextWindowTokens } from '@/hooks/useModelContextWindowTokens';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useTokenCount } from '@/hooks/useTokenCount';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useChatStore } from '@/store/chat';
import { dbMessageSelectors, topicSelectors } from '@/store/chat/selectors';
import { useToolStore } from '@/store/tool';
import { pluginHelpers } from '@/store/tool/helpers';
import { getTextInputUnitRate, getTextOutputUnitRate } from '@/utils/pricing';

import { useAgentId } from '../../hooks/useAgentId';
import ActionPopover from '../components/ActionPopover';
import TokenProgress from './TokenProgress';

const toolNameResolver = new ToolNameResolver();

interface TokenTagProps {
  total: string;
}
const Token = memo<TokenTagProps>(({ total: messageString }) => {
  const { t } = useTranslation(['chat', 'components']);

  const [input, historySummary] = useChatStore((s) => [
    s.inputMessage,
    topicSelectors.currentActiveTopicSummary(s)?.content || '',
  ]);

  const agentId = useAgentId();
  const [systemRole, model, provider] = useAgentStore((s) => {
    return [
      agentByIdSelectors.getAgentSystemRoleById(agentId)(s),
      agentByIdSelectors.getAgentModelById(agentId)(s),
      agentByIdSelectors.getAgentModelProviderById(agentId)(s),
      // add these two params to enable the component to re-render
      chatConfigByIdSelectors.getHistoryCountById(agentId)(s),
      chatConfigByIdSelectors.getEnableHistoryCountById(agentId)(s),
    ];
  });

  const [historyCount, enableHistoryCount] = useAgentStore((s) => [
    chatConfigByIdSelectors.getHistoryCountById(agentId)(s),
    chatConfigByIdSelectors.getEnableHistoryCountById(agentId)(s),
    // need to re-render by search mode
    chatConfigByIdSelectors.isEnableSearchById(agentId)(s),
    chatConfigByIdSelectors.getUseModelBuiltinSearchById(agentId)(s),
  ]);

  const maxTokens = useModelContextWindowTokens(model, provider);

  // Tool usage token
  const canUseTool = useModelSupportToolUse(model, provider);
  const pluginIds = useAgentStore((s) => agentByIdSelectors.getAgentPluginsById(agentId)(s));

  const toolsString = useToolStore(() => {
    const toolsEngine = createAgentToolsEngine({ model, provider });

    const { tools, enabledManifests } = toolsEngine.generateToolsDetailed({
      model,
      provider,
      toolIds: pluginIds,
    });
    const schemaNumber = tools?.map((i) => JSON.stringify(i)).join('') || '';

    // Generate plugin system roles from enabledManifests
    const toolsSystemRole =
      enabledManifests.length > 0
        ? pluginPrompts({
            tools: enabledManifests.map((manifest) => ({
              apis: manifest.api.map((api) => ({
                desc: api.description,
                name: toolNameResolver.generate(manifest.identifier, api.name, manifest.type),
              })),
              identifier: manifest.identifier,
              name: pluginHelpers.getPluginTitle(manifest.meta) || manifest.identifier,
              systemRole: manifest.systemRole,
            })),
          })
        : '';

    return toolsSystemRole + schemaNumber;
  });

  const toolsToken = useTokenCount(canUseTool ? toolsString : '');

  // Chat usage token
  const inputTokenCount = useTokenCount(input);

  const chatsString = useMemo(() => {
    const chats = dbMessageSelectors.activeDbMessages(useChatStore.getState());
    return chats.map((chat) => chat.content).join('');
  }, [messageString, historyCount, enableHistoryCount]);

  const chatsToken = useTokenCount(chatsString) + inputTokenCount;

  // SystemRole token
  const systemRoleToken = useTokenCount(systemRole);
  const historySummaryToken = useTokenCount(historySummary);

  // Total token
  const totalToken = systemRoleToken + historySummaryToken + toolsToken + chatsToken;

  // Pre-flight cost estimate in rubles for this next request. Pulls the
  // model's $/M input rate from its card, applies our flat tier markup,
  // and converts to RUB. This is an ESTIMATE only — actual billing uses
  // the real tokenizer count plus per-tier-row markup at debit time.
  // See packages/utils/src/pricing.ts and the daily TG report doc.
  const modelCard = useAiInfraStore(aiModelSelectors.getModelCard(model, provider));
  const costEstimate = useMemo(() => {
    if (!modelCard?.pricing) return null;
    const inputUsdPerM = getTextInputUnitRate(modelCard.pricing);
    const outputUsdPerM = getTextOutputUnitRate(modelCard.pricing);
    if (!inputUsdPerM) return null;
    // Tier classification matches compute-cost.ts on the server side.
    // We don't know output_per_1m here yet, so we infer the tier from it
    // when available and fall back to "premium" multiplier otherwise.
    const out = outputUsdPerM ?? 0;
    const tierMultiplier = out === 0 ? 2.5 : out <= 1 ? 10 : out <= 5 ? 5 : out <= 15 ? 4 : 2.5;
    const USD_TO_RUB = 90;
    const providerCostRub = (totalToken / 1_000_000) * inputUsdPerM * USD_TO_RUB;
    const userChargedRub = providerCostRub * tierMultiplier;
    return { providerCostRub, userChargedRub };
  }, [modelCard, totalToken]);

  const content = (
    <Flexbox gap={12} style={{ minWidth: 200 }}>
      <Flexbox horizontal align={'center'} gap={4} justify={'space-between'} width={'100%'}>
        <div style={{ color: cssVar.colorTextDescription }}>{t('tokenDetails.title')}</div>
        <Tooltip
          styles={{ root: { maxWidth: 'unset', pointerEvents: 'none' } }}
          title={t('ModelSelect.featureTag.tokens', {
            ns: 'components',
            tokens: numeral(maxTokens).format('0,0'),
          })}
        >
          <Center
            height={20}
            paddingInline={4}
            style={{
              background: cssVar.colorFillTertiary,
              borderRadius: 4,
              color: cssVar.colorTextSecondary,
              fontFamily: cssVar.fontFamilyCode,
              fontSize: 11,
            }}
          >
            TOKEN
          </Center>
        </Tooltip>
      </Flexbox>
      <TokenProgress
        showIcon
        data={[
          {
            color: cssVar.magenta,
            id: 'systemRole',
            title: t('tokenDetails.systemRole'),
            value: systemRoleToken,
          },
          {
            color: cssVar.geekblue,
            id: 'tools',
            title: t('tokenDetails.tools'),
            value: toolsToken,
          },
          {
            color: cssVar.orange,
            id: 'historySummary',
            title: t('tokenDetails.historySummary'),
            value: historySummaryToken,
          },
          {
            color: cssVar.gold,
            id: 'chats',
            title: t('tokenDetails.chats'),
            value: chatsToken,
          },
        ]}
      />
      <TokenProgress
        showIcon
        showTotal={t('tokenDetails.total')}
        data={[
          {
            color: cssVar.colorSuccess,
            id: 'used',
            title: t('tokenDetails.used'),
            value: totalToken,
          },
          {
            color: cssVar.colorFill,
            id: 'rest',
            title: t('tokenDetails.rest'),
            value: maxTokens - totalToken,
          },
        ]}
      />
      {costEstimate && (
        <Flexbox
          gap={4}
          style={{
            borderTop: `1px solid ${cssVar.colorFillTertiary}`,
            paddingTop: 8,
          }}
        >
          <Flexbox horizontal align="center" justify="space-between">
            <span style={{ color: cssVar.colorTextDescription, fontSize: 12 }}>
              Стоимость ввода (оценка)
            </span>
            <span style={{ fontWeight: 500 }}>
              ≈{' '}
              {costEstimate.userChargedRub < 0.01
                ? '< 0.01'
                : costEstimate.userChargedRub < 1
                  ? costEstimate.userChargedRub.toFixed(2)
                  : numeral(costEstimate.userChargedRub).format('0,0.0')}{' '}
              ₽
            </span>
          </Flexbox>
          <span style={{ color: cssVar.colorTextDescription, fontSize: 11 }}>
            Реальная цена считается после ответа модели по фактическим токенам. Output, как правило,
            в 3–6× дороже input.
          </span>
        </Flexbox>
      )}
    </Flexbox>
  );

  return (
    <ActionPopover content={content}>
      <TokenTag
        maxValue={maxTokens}
        mode={'used'}
        value={totalToken}
        text={{
          overload: t('tokenTag.overload'),
          remained: t('tokenTag.remained'),
          used: t('tokenTag.used'),
        }}
      />
    </ActionPopover>
  );
});

export default Token;
