'use client';

import { type ReactNode, useCallback, useState } from 'react';

import UpsellModal, { type UpsellFallbackAction } from '@/features/UIMode/UpsellModal';
import LockedModelUpsellSheet from '@/features/Upsell/LockedModelUpsellSheet';
import { useIsMobile } from '@/hooks/useIsMobile';

export interface LockedModelUpsellRequest {
  fallbackAction?: UpsellFallbackAction;
  modelId: string;
  modelName: string;
  requiredPlan: { name: string; priceRub: number };
}

/**
 * One place that decides which upsell surface a locked model gets —
 * `UpsellModal` on desktop, `LockedModelUpsellSheet` on a phone — and holds
 * its open state. Callers get `open(request)` plus a `node` to render once
 * in their tree.
 */
export const useLockedModelUpsell = (): {
  close: () => void;
  node: ReactNode;
  open: (request: LockedModelUpsellRequest) => void;
} => {
  const isMobile = useIsMobile();
  const [request, setRequest] = useState<LockedModelUpsellRequest | null>(null);

  const open = useCallback((next: LockedModelUpsellRequest) => setRequest(next), []);
  const close = useCallback(() => setRequest(null), []);

  const node = request ? (
    isMobile ? (
      <LockedModelUpsellSheet
        open
        fallbackAction={request.fallbackAction}
        modelId={request.modelId}
        requiredPlanName={request.requiredPlan.name}
        requiredPlanPriceRub={request.requiredPlan.priceRub}
        onClose={close}
      />
    ) : (
      <UpsellModal
        open
        fallbackAction={request.fallbackAction}
        modelName={request.modelName}
        planPriceRub={request.requiredPlan.priceRub}
        requiredPlan={request.requiredPlan.name}
        onClose={close}
      />
    )
  ) : null;

  return { close, node, open };
};
