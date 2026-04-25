'use client';

import { lambdaQuery } from '@/libs/trpc/client';

/**
 * Resolve whether the given modelId is locked for the current user's plan.
 * Cached at the tRPC layer; staleTime is large because plan changes are rare.
 */
export const useModelLockState = (modelId: string | undefined) => {
  return lambdaQuery.spend.requiredPlanForModel.useQuery(
    { modelId: modelId ?? '' },
    {
      enabled: !!modelId,
      retry: false,
      staleTime: 5 * 60 * 1000,
      throwOnError: false,
    },
  );
};
