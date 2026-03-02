import { useMemo } from 'react';

import { RECOMMENDED_MODELS } from '@/const/recommended-models';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

import { type GroupMode, type ListItem, type ModelWithProviders } from '../types';

export const useBuildListItems = (
  enabledList: EnabledProviderWithModels[],
  groupMode: GroupMode,
  searchKeyword: string = '',
  showAll: boolean = false,
): ListItem[] => {
  return useMemo(() => {
    if (enabledList.length === 0) {
      return [{ type: 'no-provider' }] as ListItem[];
    }

    const matchesSearch = (text: string): boolean => {
      if (!searchKeyword.trim()) return true;
      const keyword = searchKeyword.toLowerCase().trim();
      return text.toLowerCase().includes(keyword);
    };

    // lobehub first, then others
    const sortedProviders = [...enabledList].sort((a, b) => {
      const aIsLobehub = a.id === 'lobehub';
      const bIsLobehub = b.id === 'lobehub';
      if (aIsLobehub && !bIsLobehub) return -1;
      if (!aIsLobehub && bIsLobehub) return 1;
      return 0;
    });

    // Build recommended items when not searching
    const recommendedItems: ListItem[] = [];
    if (!searchKeyword.trim()) {
      const recModels: ListItem[] = [];
      for (const rec of RECOMMENDED_MODELS) {
        for (const provider of sortedProviders) {
          const found = provider.children.find((m) => m.id === rec.modelId);
          if (found) {
            recModels.push({
              description: rec.description,
              model: found,
              providerId: provider.id,
              type: 'recommended-model',
            });
            break;
          }
        }
      }
      if (recModels.length > 0) {
        recommendedItems.push({ type: 'recommended-header' });
        recommendedItems.push(...recModels);
      }
    }

    if (groupMode === 'byModel') {
      const modelMap = new Map<string, ModelWithProviders>();

      for (const providerItem of sortedProviders) {
        for (const modelItem of providerItem.children) {
          const displayName = modelItem.displayName || modelItem.id;

          if (!matchesSearch(displayName) && !matchesSearch(providerItem.name)) {
            continue;
          }

          if (!modelMap.has(displayName)) {
            modelMap.set(displayName, {
              displayName,
              model: modelItem,
              providers: [],
            });
          }

          const entry = modelMap.get(displayName)!;
          entry.providers.push({
            id: providerItem.id,
            logo: providerItem.logo,
            name: providerItem.name,
            source: providerItem.source,
          });
        }
      }

      // lobehub first
      const modelArray = Array.from(modelMap.values());
      for (const model of modelArray) {
        model.providers.sort((a, b) => {
          const aIsLobehub = a.id === 'lobehub';
          const bIsLobehub = b.id === 'lobehub';
          if (aIsLobehub && !bIsLobehub) return -1;
          if (!aIsLobehub && bIsLobehub) return 1;
          return 0;
        });
      }

      const regularItems = modelArray
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .map((data) => ({
          data,
          type:
            data.providers.length === 1
              ? ('model-item-single' as const)
              : ('model-item-multiple' as const),
        }));

      if (!showAll && recommendedItems.length > 0) {
        return [
          ...recommendedItems,
          { count: regularItems.length, type: 'show-all-toggle' as const },
        ];
      }

      return [...recommendedItems, ...regularItems];
    } else {
      const items: ListItem[] = [];

      for (const providerItem of sortedProviders) {
        const filteredModels = providerItem.children.filter(
          (modelItem) =>
            matchesSearch(modelItem.displayName || modelItem.id) ||
            matchesSearch(providerItem.name),
        );

        if (filteredModels.length > 0 || !searchKeyword.trim()) {
          items.push({ provider: providerItem, type: 'group-header' });

          if (filteredModels.length === 0) {
            items.push({ provider: providerItem, type: 'empty-model' });
          } else {
            for (const modelItem of filteredModels) {
              items.push({
                model: modelItem,
                provider: providerItem,
                type: 'provider-model-item',
              });
            }
          }
        }
      }

      if (!showAll && recommendedItems.length > 0) {
        return [...recommendedItems, { count: items.length, type: 'show-all-toggle' as const }];
      }

      return [...recommendedItems, ...items];
    }
  }, [enabledList, groupMode, searchKeyword, showAll]);
};
