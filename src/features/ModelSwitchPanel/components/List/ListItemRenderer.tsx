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

import { styles } from '../../styles';
import { type ListItem } from '../../types';
import { menuKey } from '../../utils';
import ModelDetailPanel from '../ModelDetailPanel';
import { MultipleProvidersModelItem } from './MultipleProvidersModelItem';
import { SingleProviderModelItem } from './SingleProviderModelItem';

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
        const key = menuKey(item.provider.id, item.model.id);
        const isActive = key === activeKey;

        return (
          <Flexbox style={{ marginBlock: 1, marginInline: 4 }}>
            <DropdownMenuSubmenuRoot open={detailOpen} onOpenChange={setDetailOpen}>
              <DropdownMenuSubmenuTrigger
                className={cx(menuSharedStyles.item, isActive && styles.menuItemActive)}
                style={{ paddingBlock: 8, paddingInline: 8 }}
                onClick={async () => {
                  setDetailOpen(false);
                  onModelChange(item.model.id, item.provider.id);
                  onClose();
                }}
              >
                <ModelItemRender
                  {...item.model}
                  {...item.model.abilities}
                  showInfoTag
                  newBadgeLabel={newLabel}
                />
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
            <Block
              clickable
              className={cx(menuSharedStyles.item, isActive && styles.menuItemActive)}
              gap={2}
              style={{ paddingBlock: 6, paddingInline: 8 }}
              variant={'borderless'}
              onClick={async () => {
                onModelChange(item.model.id, item.providerId);
                onClose();
              }}
            >
              <ModelItemRender
                {...item.model}
                {...item.model.abilities}
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
                {item.description} · ~{item.creditCost} кр.
              </span>
            </Block>
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
