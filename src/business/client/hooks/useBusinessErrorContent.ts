import { type ErrorType } from '@lobechat/types';

export interface BusinessErrorContentResult {
  errorType?: string;
  hideMessage?: boolean;
}

export default function useBusinessErrorContent(
  errorType?: ErrorType | string,
): BusinessErrorContentResult {
  // PlanLimitExceeded is rendered fully by useRenderBusinessChatErrorMessageExtra
  // (custom Block + upgrade CTA). Hide the upstream alert message so the
  // user doesn't see the error twice.
  if (errorType === 'PlanLimitExceeded') {
    return { hideMessage: true };
  }
  return {};
}
