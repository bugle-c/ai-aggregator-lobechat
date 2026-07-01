'use client';

import { Flexbox } from '@lobehub/ui';
import { App, Skeleton } from 'antd';
import { ArrowRight } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { SESSION_CHAT_URL } from '@/const/url';
import { useIsMobile } from '@/hooks/useIsMobile';
import { agentService } from '@/services/agent';
import { discoverService } from '@/services/discover';
import { useAgentStore } from '@/store/agent';
import { useDiscoverStore } from '@/store/discover';
import { useHomeStore } from '@/store/home';
import { AssistantSorts, type DiscoverAssistantItem } from '@/types/discover';

import HomeAssistantItem from './Item';

const PAGE_SIZE = 9;
/** Route of the full community agent marketplace (verified to exist). */
const MARKETPLACE_PATH = '/community/agent';
/** Stable keys for the skeleton placeholder cells. */
const SKELETON_KEYS = Array.from({ length: PAGE_SIZE }, (_, i) => `assistant-skeleton-${i}`);

/**
 * "Популярные ассистенты" — a compact card grid of ready-made assistants from
 * the LobeChat discover marketplace (remote lobehub fetch).
 *
 * Layout: ~3 columns on desktop, 2 on tablet, a horizontal-scroll strip on
 * mobile (each card fixed-width so the row never collapses into a stack).
 *
 * Robustness: the data is a remote fetch that RU users may have throttled
 * (DPI). It shows a skeleton while loading and self-hides (renders null) when
 * the list is empty or the fetch errors — it must NEVER block or break the
 * home.
 *
 * Click behavior: clicking a card immediately creates a chat with that
 * assistant and opens it (GPTunnel-style one-click start), reusing the proven
 * "add agent and converse" flow from the community detail page. Cards whose
 * list payload lacks a usable config (no `systemRole`) fall back to the
 * marketplace detail page, which fetches the full config and has its own
 * start button.
 */
const HomeAssistants = memo(() => {
  const { t } = useTranslation('home');
  const isMobile = useIsMobile();
  const navigate = useHomeStore((s) => s.navigate);

  // Proven "add agent and converse" primitives (mirrors community AddAgent).
  const createAgent = useAgentStore((s) => s.createAgent);
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
  const routerNavigate = useNavigate();
  const { message, modal } = App.useApp();

  /** Identifier of the card whose create is in-flight (for the loading UI). */
  const [startingId, setStartingId] = useState<string | null>(null);

  const useAssistantList = useDiscoverStore((s) => s.useAssistantList);
  const { data, isLoading, error } = useAssistantList({
    page: 1,
    pageSize: PAGE_SIZE,
    sort: AssistantSorts.Recommended,
  });

  const createAndConverse = useCallback(
    async (item: DiscoverAssistantItem) => {
      const { identifier, title, avatar, backgroundColor, description, tags, config } = item;

      const meta = {
        avatar,
        backgroundColor,
        description,
        marketIdentifier: identifier,
        tags,
        title,
      };
      // Note: agentService.createAgent normalizes market config (model as object).
      // The home list item has no `editorData`, so we omit it (detail page spreads it).
      const agentData = { config: { ...config, ...meta } };

      const result = await createAgent(agentData);
      await refreshAgentList();

      if (identifier) {
        discoverService.reportAgentInstall(identifier);
        discoverService.reportAgentEvent({
          event: 'add',
          identifier,
          source: location.pathname,
        });
      }

      message.success(t('assistants.addAgentSuccess', { ns: 'discover' }));
      routerNavigate(SESSION_CHAT_URL(result.agentId || result.sessionId, isMobile));
    },
    [createAgent, refreshAgentList, routerNavigate, message, t, isMobile],
  );

  const openAssistant = useCallback(
    async (item: DiscoverAssistantItem) => {
      // No-op while another card's create is in-flight (prevents double-clicks).
      if (startingId) return;

      // Fallback: cards without a usable config (e.g. a future remote-market
      // card whose list payload omits systemRole) go to the detail page.
      if (!item.config || !item.config.systemRole) {
        navigate?.(urlJoin(MARKETPLACE_PATH, item.identifier));
        return;
      }

      setStartingId(item.identifier);
      try {
        const { identifier, title } = item;
        const isDuplicate = identifier
          ? await agentService.checkByMarketIdentifier(identifier)
          : false;

        if (isDuplicate) {
          modal.confirm({
            cancelText: t('cancel', { ns: 'common' }),
            content: t('assistants.duplicateAdd.content', { ns: 'discover', title }),
            okText: t('assistants.duplicateAdd.ok', { ns: 'discover' }),
            onCancel: () => setStartingId(null),
            onOk: async () => {
              try {
                await createAndConverse(item);
              } finally {
                setStartingId(null);
              }
            },
            title: t('assistants.duplicateAdd.title', { ns: 'discover' }),
          });
          // Keep startingId set until the modal is resolved (ok/cancel above).
          return;
        }

        await createAndConverse(item);
        setStartingId(null);
      } catch {
        setStartingId(null);
      }
    },
    [startingId, navigate, modal, t, createAndConverse],
  );

  // Self-hide on a failed remote fetch or a genuinely empty list — never block
  // the home. While loading we keep the section and show a skeleton grid.
  if (!isLoading && (error || !data || data.items.length === 0)) return null;

  const items = (data?.items ?? []).slice(0, PAGE_SIZE);

  // Each cell: responsive flex column. Desktop ~3 / tablet ~2 columns via
  // flex-basis breakpoints; mobile becomes a fixed-width horizontal strip.
  const cellStyle = isMobile
    ? ({ flex: '0 0 220px', minWidth: 220 } as const)
    : ({ flex: '1 1 30%', maxWidth: 'calc(33.333% - 12px)', minWidth: 240 } as const);

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align="center" justify="space-between" paddingInline={16}>
        <span style={{ fontSize: 18, fontWeight: 600 }}>{t('assistants.title')}</span>
        <a
          style={{
            alignItems: 'center',
            color: 'var(--ant-color-text-secondary)',
            display: 'inline-flex',
            fontSize: 14,
            gap: 4,
          }}
          onClick={(e) => {
            e.preventDefault();
            navigate?.(MARKETPLACE_PATH);
          }}
        >
          {t('assistants.all')}
          <ArrowRight size={14} />
        </a>
      </Flexbox>

      <div
        style={{
          display: 'flex',
          flexWrap: isMobile ? 'nowrap' : 'wrap',
          gap: 12,
          overflowX: isMobile ? 'auto' : 'visible',
          paddingBlockEnd: isMobile ? 4 : 0,
          paddingInline: 16,
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {isLoading
          ? SKELETON_KEYS.map((key) => (
              <div key={key} style={cellStyle}>
                <Skeleton.Node active style={{ borderRadius: 12, height: 116, width: '100%' }} />
              </div>
            ))
          : items.map((item) => (
              <div key={item.identifier} style={cellStyle}>
                <HomeAssistantItem
                  {...item}
                  loading={startingId === item.identifier}
                  onClick={() => openAssistant(item)}
                />
              </div>
            ))}
      </div>
    </Flexbox>
  );
});

HomeAssistants.displayName = 'HomeAssistants';

export default HomeAssistants;
