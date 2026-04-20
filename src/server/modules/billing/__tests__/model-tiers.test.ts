import { describe, expect, it } from 'vitest';

import { classifyModelTier, getRequiredPlanForModel, isModelAllowedForPlan } from '../model-tiers';

describe('classifyModelTier', () => {
  it('classifies claude-opus as premium', () => {
    expect(classifyModelTier('claude-opus-4-6')).toBe('premium');
    expect(classifyModelTier('anthropic/claude-opus-4-6')).toBe('premium');
  });

  it('classifies claude-haiku as mid (output $5)', () => {
    expect(classifyModelTier('claude-haiku-4-5-20251001')).toBe('mid');
  });

  it('classifies gpt-5-nano as cheap', () => {
    expect(classifyModelTier('gpt-5-nano')).toBe('cheap');
  });

  it('classifies gemini-2.5-pro as high (output $10)', () => {
    expect(classifyModelTier('gemini-2.5-pro')).toBe('high');
  });

  it('classifies claude-sonnet as high (output $15)', () => {
    expect(classifyModelTier('claude-sonnet-4-6')).toBe('high');
  });

  it('defaults unknown model to high (DEFAULT output = 15)', () => {
    expect(classifyModelTier('unknown-mystery-model')).toBe('high');
  });
});

describe('isModelAllowedForPlan', () => {
  it('free plan allows only cheap', () => {
    expect(isModelAllowedForPlan('gpt-5-nano', 'free')).toBe(true);
    expect(isModelAllowedForPlan('claude-haiku-4-5-20251001', 'free')).toBe(false);
    expect(isModelAllowedForPlan('claude-opus-4-6', 'free')).toBe(false);
    expect(isModelAllowedForPlan('gemini-2.5-pro', 'free')).toBe(false);
  });

  it('basic plan allows cheap and mid', () => {
    expect(isModelAllowedForPlan('gpt-5-nano', 'basic')).toBe(true);
    expect(isModelAllowedForPlan('claude-haiku-4-5-20251001', 'basic')).toBe(true);
    expect(isModelAllowedForPlan('gemini-2.5-pro', 'basic')).toBe(false);
    expect(isModelAllowedForPlan('claude-opus-4-6', 'basic')).toBe(false);
  });

  it('pro plan allows everything', () => {
    expect(isModelAllowedForPlan('gpt-5-nano', 'pro')).toBe(true);
    expect(isModelAllowedForPlan('claude-haiku-4-5-20251001', 'pro')).toBe(true);
    expect(isModelAllowedForPlan('gemini-2.5-pro', 'pro')).toBe(true);
    expect(isModelAllowedForPlan('claude-opus-4-6', 'pro')).toBe(true);
  });

  it('unknown plan defaults to free (cheap only)', () => {
    expect(isModelAllowedForPlan('gpt-5-nano', 'bogus')).toBe(true);
    expect(isModelAllowedForPlan('claude-opus-4-6', 'bogus')).toBe(false);
  });

  it('unknown model defaults to high tier -> only pro allowed', () => {
    expect(isModelAllowedForPlan('unknown-mystery-model', 'free')).toBe(false);
    expect(isModelAllowedForPlan('unknown-mystery-model', 'basic')).toBe(false);
    expect(isModelAllowedForPlan('unknown-mystery-model', 'pro')).toBe(true);
  });
});

describe('getRequiredPlanForModel', () => {
  it('returns free for cheap models', () => {
    expect(getRequiredPlanForModel('gpt-5-nano')).toBe('free');
  });

  it('returns basic for mid models', () => {
    expect(getRequiredPlanForModel('claude-haiku-4-5-20251001')).toBe('basic');
  });

  it('returns pro for high models', () => {
    expect(getRequiredPlanForModel('gemini-2.5-pro')).toBe('pro');
  });

  it('returns pro for premium models', () => {
    expect(getRequiredPlanForModel('claude-opus-4-6')).toBe('pro');
  });
});
