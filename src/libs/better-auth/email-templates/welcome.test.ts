import { describe, expect, it } from 'vitest';

import { getWelcomeEmailTemplate } from './welcome';

describe('getWelcomeEmailTemplate', () => {
  it('writes a Russian welcome email with free credits, starter prompts and pricing CTA', () => {
    const template = getWelcomeEmailTemplate({ appUrl: 'https://ask.gptweb.ru', userName: 'Паша' });

    expect(template.subject).toContain('Добро пожаловать');
    expect(template.text).toContain('бесплатные кредиты');
    expect(template.text).toContain('https://ask.gptweb.ru');
    expect(template.text).toContain('490');
    expect(template.html).toContain('Сравни Claude, GPT и Gemini');
    expect(template.html).toContain('https://ask.gptweb.ru/settings/plans');
  });
});
