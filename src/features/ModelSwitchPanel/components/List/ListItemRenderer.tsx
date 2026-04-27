import {
  ActionIcon,
  Block,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuSubmenuRoot,
  DropdownMenuSubmenuTrigger,
  Flexbox,
  Icon,
  menuSharedStyles,
} from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { ChevronDown, LucideArrowRight, LucideBolt, Star } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { ModelItemRender, ProviderItemRender } from '@/components/ModelSelect';
import { LockedModelTooltip, useModelLockState } from '@/features/UIMode';

import { styles } from '../../styles';
import { type ListItem } from '../../types';
import { menuKey } from '../../utils';
import ModelDetailPanel from '../ModelDetailPanel';
import { MultipleProvidersModelItem } from './MultipleProvidersModelItem';
import { SingleProviderModelItem } from './SingleProviderModelItem';

interface RecommendedModelRowProps {
  creditCost: number;
  description: string;
  isActive: boolean;
  model: {
    abilities?: Record<string, unknown>;
    displayName?: string;
    id: string;
  } & Record<string, unknown>;
  newLabel: string;
  onClose: () => void;
  onModelChange: (modelId: string, providerId: string) => Promise<void>;
  providerId: string;
}

const RecommendedModelRow = memo<RecommendedModelRowProps>(
  ({ model, providerId, isActive, newLabel, description, creditCost, onModelChange, onClose }) => {
    const { data: lockState } = useModelLockState(model.id);
    const isLocked = lockState?.isLocked ?? false;

    const handleClick = async () => {
      if (isLocked) return;
      try {
        await onModelChange(model.id, providerId);
      } catch (err) {
        console.error('[ModelSwitchPanel] onModelChange failed for recommended model', err);
      }
      onClose();
    };

    const content = (
      <Block
        clickable
        className={cx(menuSharedStyles.item, isActive && styles.menuItemActive)}
        gap={2}
        style={{ paddingBlock: 6, paddingInline: 8 }}
        variant={'borderless'}
        onClick={isLocked ? undefined : handleClick}
      >
        <ModelItemRender
          {...(model as any)}
          {...((model.abilities ?? {}) as any)}
          showInfoTag
          newBadgeLabel={newLabel}
        />
        <span
          style={{
            color: cssVar.colorTextTertiary,
            fontSize: 11,
            lineHeight: '14px',
            paddingInlineStart: 2,
          }}
        >
          {description} · ~{creditCost} кр.
        </span>
      </Block>
    );

    return (
      <LockedModelTooltip
        isLocked={isLocked}
        modelName={model.displayName ?? model.id}
        planPriceRub={lockState?.requiredPlan?.priceRub ?? 0}
        requiredPlan={lockState?.requiredPlan?.name ?? 'Pro'}
      >
        {content}
      </LockedModelTooltip>
    );
  },
);

RecommendedModelRow.displayName = 'RecommendedModelRow';

/**
 * `provider-model-item` row used in byProvider mode. Wraps `ModelItemRender`
 * in `LockedModelTooltip` so the lock indicator + upsell modal work in this
 * mode the same way they do for byModel rows. Without this wrapper, free
 * users see premium models with no lock affordance.
 */
interface ProviderModelRowProps {
  activeKey: string;
  detailOpen: boolean;
  extraControls?: (modelId: string, providerId: string) => ReactNode;
  item: Extract<ListItem, { type: 'provider-model-item' }>;
  newLabel: string;
  onClose: () => void;
  onModelChange: (modelId: string, providerId: string) => Promise<void>;
  setDetailOpen: (open: boolean) => void;
}

const ProviderModelRow = memo<ProviderModelRowProps>(
  ({
    activeKey,
    detailOpen,
    extraControls,
    item,
    newLabel,
    setDetailOpen,
    onClose,
    onModelChange,
  }) => {
    const key = menuKey(item.provider.id, item.model.id);
    const isActive = key === activeKey;
    const { data: lockState } = useModelLockState(item.model.id);
    const isLocked = lockState?.isLocked ?? false;

    return (
      <DropdownMenuSubmenuRoot open={detailOpen} onOpenChange={setDetailOpen}>
        <DropdownMenuSubmenuTrigger
          className={cx(menuSharedStyles.item, isActive && styles.menuItemActive)}
          style={{ paddingBlock: 8, paddingInline: 8 }}
          onClick={async () => {
            if (isLocked) return;
            setDetailOpen(false);
            await onModelChange(item.model.id, item.provider.id);
            onClose();
          }}
        >
          <LockedModelTooltip
            isLocked={isLocked}
            modelName={item.model.displayName ?? item.model.id}
            planPriceRub={lockState?.requiredPlan?.priceRub ?? 0}
            requiredPlan={lockState?.requiredPlan?.name ?? 'Pro'}
          >
            <ModelItemRender
              {...item.model}
              {...item.model.abilities}
              showInfoTag
              newBadgeLabel={newLabel}
            />
          </LockedModelTooltip>
        </DropdownMenuSubmenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuPositioner anchor={null} placement="right" sideOffset={8}>
            <DropdownMenuPopup className={styles.detailPopup}>
              <ModelDetailPanel
                extraControls={extraControls?.(item.model.id, item.provider.id)}
                model={item.model}
              />
            </DropdownMenuPopup>
          </DropdownMenuPositioner>
        </DropdownMenuPortal>
      </DropdownMenuSubmenuRoot>
    );
  },
);

ProviderModelRow.displayName = 'ProviderModelRow';

interface ListItemRendererProps {
  activeKey: string;
  extraControls?: (modelId: string, providerId: string) => ReactNode;
  isScrolling: boolean;
  item: ListItem;
  newLabel: string;
  onClose: () => void;
  onModelChange: (modelId: string, providerId: string) => Promise<void>;
  onToggleShowAll?: () => void;
}

export const ListItemRenderer = memo<ListItemRendererProps>(
  ({
    activeKey,
    extraControls,
    isScrolling,
    item,
    newLabel,
    onModelChange,
    onClose,
    onToggleShowAll,
  }) => {
    const { t } = useTranslation('components');
    const navigate = useNavigate();
    const [detailOpen, setDetailOpen] = useState(false);

    useEffect(() => {
      if (isScrolling) {
        setDetailOpen(false);
      }
    }, [isScrolling]);

    switch (item.type) {
      case 'no-provider': {
        return (
          <Block
            clickable
            horizontal
            className={styles.menuItem}
            gap={8}
            key="no-provider"
            style={{ color: cssVar.colorTextTertiary }}
            variant={'borderless'}
            onClick={() => navigate('/settings/provider/all')}
          >
            {t('ModelSwitchPanel.emptyProvider')}
            <Icon icon={LucideArrowRight} />
          </Block>
        );
      }

      case 'group-header': {
        return (
          <Flexbox
            horizontal
            className={styles.groupHeader}
            justify="space-between"
            key={`header-${item.provider.id}`}
            paddingBlock={'12px 4px'}
            paddingInline={'12px 8px'}
          >
            <ProviderItemRender
              logo={item.provider.logo}
              name={item.provider.name}
              provider={item.provider.id}
              source={item.provider.source}
            />
            <ActionIcon
              className="settings-icon"
              icon={LucideBolt}
              size={'small'}
              title={t('ModelSwitchPanel.goToSettings')}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const url = urlJoin('/settings/provider', item.provider.id || 'all');
                if (e.ctrlKey || e.metaKey) {
                  window.open(url, '_blank');
                } else {
                  navigate(url);
                }
              }}
            />
          </Flexbox>
        );
      }

      case 'empty-model': {
        return (
          <Flexbox
            horizontal
            className={styles.menuItem}
            gap={8}
            key={`empty-${item.provider.id}`}
            style={{ color: cssVar.colorTextTertiary }}
            onClick={() => navigate(`/settings/provider/${item.provider.id}`)}
          >
            {t('ModelSwitchPanel.emptyModel')}
            <Icon icon={LucideArrowRight} />
          </Flexbox>
        );
      }

      case 'provider-model-item': {
        return (
          <Flexbox style={{ marginBlock: 1, marginInline: 4 }}>
            <ProviderModelRow
              activeKey={activeKey}
              detailOpen={detailOpen}
              extraControls={extraControls}
              item={item}
              newLabel={newLabel}
              setDetailOpen={setDetailOpen}
              onClose={onClose}
              onModelChange={onModelChange}
            />
          </Flexbox>
        );
      }

      case 'model-item-single': {
        const singleProvider = item.data.providers[0];
        const key = menuKey(singleProvider.id, item.data.model.id);
        const isActive = key === activeKey;

        return (
          <Flexbox style={{ marginBlock: 1, marginInline: 4 }}>
            <DropdownMenuSubmenuRoot open={detailOpen} onOpenChange={setDetailOpen}>
              <DropdownMenuSubmenuTrigger
                className={cx(menuSharedStyles.item, isActive && styles.menuItemActive)}
                style={{ paddingBlock: 8, paddingInline: 8 }}
                onClick={async () => {
                  setDetailOpen(false);
                  onModelChange(item.data.model.id, singleProvider.id);
                  onClose();
                }}
              >
                <SingleProviderModelItem data={item.data} newLabel={newLabel} />
              </DropdownMenuSubmenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuPositioner anchor={null} placement="right" sideOffset={8}>
                  <DropdownMenuPopup className={styles.detailPopup}>
                    <ModelDetailPanel
                      extraControls={extraControls?.(item.data.model.id, singleProvider.id)}
                      model={item.data.model}
                    />
                  </DropdownMenuPopup>
                </DropdownMenuPositioner>
              </DropdownMenuPortal>
            </DropdownMenuSubmenuRoot>
          </Flexbox>
        );
      }

      case 'model-item-multiple': {
        return (
          <Flexbox key={item.data.displayName} style={{ marginBlock: 1, marginInline: 4 }}>
            <MultipleProvidersModelItem
              activeKey={activeKey}
              data={item.data}
              extraControls={extraControls}
              isScrolling={isScrolling}
              newLabel={newLabel}
              onClose={onClose}
              onModelChange={onModelChange}
            />
          </Flexbox>
        );
      }

      case 'recommended-header': {
        return (
          <Flexbox
            horizontal
            align="center"
            gap={6}
            key="recommended-header"
            paddingBlock={'8px 4px'}
            paddingInline={12}
            style={{ color: cssVar.colorTextSecondary }}
          >
            <Icon icon={Star} size={14} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>Рекомендованные</span>
          </Flexbox>
        );
      }

      case 'recommended-model': {
        const recKey = menuKey(item.providerId, item.model.id);
        const isActive = recKey === activeKey;

        return (
          <Flexbox style={{ marginBlock: 1, marginInline: 4 }}>
            <RecommendedModelRow
              creditCost={item.creditCost}
              description={item.description}
              isActive={isActive}
              model={item.model as any}
              newLabel={newLabel}
              providerId={item.providerId}
              onClose={onClose}
              onModelChange={onModelChange}
            />
          </Flexbox>
        );
      }

      case 'show-all-toggle': {
        return (
          <Flexbox style={{ marginBlock: 1, marginInline: 4 }}>
            <Block
              clickable
              horizontal
              className={styles.menuItem}
              gap={6}
              style={{ color: cssVar.colorTextSecondary, justifyContent: 'center' }}
              variant={'borderless'}
              onClick={() => onToggleShowAll?.()}
            >
              <span style={{ fontSize: 12 }}>Все модели ({item.count})</span>
              <Icon icon={ChevronDown} size={14} />
            </Block>
          </Flexbox>
        );
      }

      default: {
        return null;
      }
    }
  },
);

ListItemRenderer.displayName = 'ListItemRenderer';
