import { type ChatMessageError } from '@lobechat/types';

/**
 * Marker the chat route attaches to the credits-exhausted refusal
 * (`webapi/chat/[provider]/route.ts`, checkUsageLimit). The refusal is a
 * generic InternalServerError type, so the client tells it apart by this
 * body code; the message text is the fallback for rows persisted before
 * the code existed.
 */
export const CREDITS_EXHAUSTED_CODE = 'credits_exhausted';

const CREDITS_EXHAUSTED_TEXT = 'Кредиты закончились';

export const isCreditsExhaustedChatError = (
  error: ChatMessageError | null | undefined,
): boolean => {
  if (!error) return false;
  const body = (error.body ?? {}) as {
    code?: unknown;
    error?: { message?: unknown };
    errorMessage?: unknown;
  };
  if (body.code === CREDITS_EXHAUSTED_CODE) return true;
  const text = [body.errorMessage, body.error?.message, error.message]
    .filter((v): v is string => typeof v === 'string')
    .join('\n');
  return text.includes(CREDITS_EXHAUSTED_TEXT);
};
