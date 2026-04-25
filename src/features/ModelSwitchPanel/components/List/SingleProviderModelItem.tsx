import { memo } from 'react';

import { ModelItemRender } from '@/components/ModelSelect';
import { LockedModelTooltip, useModelLockState } from '@/features/UIMode';

import { type ModelWithProviders } from '../../types';

interface SingleProviderModelItemProps {
  data: ModelWithProviders;
  newLabel: string;
}

export const SingleProviderModelItem = memo<SingleProviderModelItemProps>(({ data, newLabel }) => {
  const { data: lockState } = useModelLockState(data.model.id);

  return (
    <LockedModelTooltip
      isLocked={lockState?.isLocked ?? false}
      modelName={data.displayName ?? data.model.id}
      planPriceRub={lockState?.requiredPlan?.priceRub ?? 0}
      requiredPlan={lockState?.requiredPlan?.name ?? 'Pro'}
    >
      <ModelItemRender
        {...data.model}
        {...data.model.abilities}
        newBadgeLabel={newLabel}
        showInfoTag={true}
      />
    </LockedModelTooltip>
  );
});

SingleProviderModelItem.displayName = 'SingleProviderModelItem';
