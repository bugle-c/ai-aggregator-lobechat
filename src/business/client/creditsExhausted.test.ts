import { describe, expect, it } from 'vitest';

import { isCreditsExhaustedChatError } from './creditsExhausted';

describe('isCreditsExhaustedChatError', () => {
  it('matches the tagged refusal from the chat route', () => {
    expect(
      isCreditsExhaustedChatError({
        body: { code: 'credits_exhausted', errorMessage: 'x', provider: 'lobehub' },
        type: 500,
      }),
    ).toBe(true);
  });

  it('falls back to the message text for rows persisted before the code existed', () => {
    expect(
      isCreditsExhaustedChatError({
        body: {
          error: { message: 'Кредиты закончились. Пополните баланс или обновите план.' },
          errorMessage: 'Кредиты закончились. Пополните баланс или обновите план.',
          provider: 'lobehub',
        },
        type: 500,
      }),
    ).toBe(true);
  });

  it('ignores other 500s, plan-limit errors and empty input', () => {
    expect(
      isCreditsExhaustedChatError({
        body: { errorMessage: 'Сервис временно недоступен. Попробуйте через минуту.' },
        type: 500,
      }),
    ).toBe(false);
    expect(
      isCreditsExhaustedChatError({ body: { requiredPlan: 'Про' }, type: 'PlanLimitExceeded' }),
    ).toBe(false);
    expect(isCreditsExhaustedChatError(null)).toBe(false);
    expect(isCreditsExhaustedChatError(undefined)).toBe(false);
  });
});
