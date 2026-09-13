import { type ChatMessageError, type ErrorType } from '@lobechat/types';

import { isCreditsExhaustedChatError } from '@/business/client/creditsExhausted';

export interface BusinessErrorContentResult {
  errorType?: string;
  hideMessage?: boolean;
}

export default function useBusinessErrorContent(
  errorType?: ErrorType | string,
  error?: ChatMessageError | null,
): BusinessErrorContentResult {
  // PlanLimitExceeded and the credits-exhausted refusal are rendered fully
  // by useRenderBusinessChatErrorMessageExtra (custom Block + CTA). Hide
  // the upstream alert message so the user doesn't see the error twice
  // (for credits it would read as a generic «server error» title).
  if (errorType === 'PlanLimitExceeded' || isCreditsExhaustedChatError(error)) {
    return { hideMessage: true };
  }
  return {};
}
