import { describe, expect, it } from 'vitest';

import { applyPresetTemplate } from './applyPresetTemplate';

describe('applyPresetTemplate', () => {
  it('replaces {{user_prompt}} with the user prompt', () => {
    expect(applyPresetTemplate('Crash zoom into {{user_prompt}}', 'a robot')).toBe(
      'Crash zoom into a robot',
    );
  });

  it('returns the user prompt unchanged when template is missing or empty', () => {
    expect(applyPresetTemplate(undefined, 'a robot')).toBe('a robot');
    expect(applyPresetTemplate('', 'a robot')).toBe('a robot');
  });

  it('handles templates with no placeholder by appending the user prompt', () => {
    expect(applyPresetTemplate('cinematic', 'a robot')).toBe('cinematic, a robot');
  });

  it('trims whitespace in user prompt', () => {
    expect(applyPresetTemplate('foo {{user_prompt}}', '   a robot   ')).toBe('foo a robot');
  });

  it('replaces every occurrence (not just the first)', () => {
    expect(applyPresetTemplate('{{user_prompt}} -> {{user_prompt}}', 'cat')).toBe('cat -> cat');
  });

  it('passes through empty user prompt by leaving placeholder empty', () => {
    expect(applyPresetTemplate('A {{user_prompt}} B', '')).toBe('A  B');
  });
});
